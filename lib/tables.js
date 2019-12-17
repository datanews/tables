/**
 * Main class for Stream to SQL.
 */

// Dependencies
var fs = require("fs");
var path = require("path");
var url = require("url");
var stream = require("stream");
var es = require("event-stream");

var _ = require("lodash");
var ProgressBar = require("progress");
var Spinner = require("cli-spinner").Spinner;
var Sequelize = require("sequelize");
var queue = require("d3-queue").queue;
var unpipe = require("unpipe");
var merge = require("merge2");
var tito = require("tito");

var output = require("./output.js");
var utils = require("./utils.js");
var dbUtils = require("./db.js");
var columnsToModel = require("./columns-to-model.js");
var autoParser = require("./auto-parser.js");


// Constructor
function Tables(options) {
  // Allow the use of .env files
  require("dotenv").config({
    silent: true
  });

  // Deterimine input types from tito (And custom)
  this.validInputTypes = tito.formats.names.concat(["custom"]);

  // Make output object
  this.output = output(options.output === undefined ? false : options.output);

  // Use defaults
  options = _.defaultsDeep(options, {
    progress: this.output.progressBarFormat,
    progressOptions: {
      complete: this.output.progressOptionsComplete,
      incomplete: this.output.progressOptionsIncomplete,
      width: 50
    },
    dbOptions: {
      // By default, logs everything to console.log
      logging: false,
      define: {
        timestamps: false
      }
    },
    batchSize: 1000,
    guessLimit: 1000,
    dataPath: this.defaultDataPath(),
    dateFormat: "MM/DD/YYYY",
    datetimeFormat: "MM/DD/YYYY HH:mm:ss a",
    autoparse: true,
    restart: false
  });

  // Attach options
  this.options = options;

  // Guess type.
  if (options.pipe) {
    options.inputType = "custom";
    options.inputOptions = options.inputOptions || {};
  }

  if (!options.inputType && options.input) {
    // Try to guess the input type from the filename
    var match = options.input.match(/\.([a-z]+)$/);
    if (match && match[1] && this.validInputTypes.indexOf(match[1].toLowerCase()) !== -1) {
      options.inputType = match[1].toLowerCase();
    }
  }

  // Use CSV is nothing can be determined
  if (!options.inputType) {
    options.inputType = "csv";
  }

  // Input option defaults
  if (options.inputType === "csv") {
    options.inputOptions = _.defaultsDeep(options.inputOptions, {
      delimiter: ",",
      quote: "\"",
      headers: true,
      ignoreEmpty: true
    });
  }
  else if (options.inputType === "json") {
    options.inputOptions = options.inputOptions || { path: "*" };
  }

  // Use input for id if not provided
  options.id = options.id || options.input || undefined;

  // Match up any environment variables
  options.db = options.db ? options.db : process.env.TABLES_DB_URI;

  // Check some options
  if (!options.input && process.stdin.isTTY) {
    this.done(new Error("If not piping in data, options.input option is required."));
  }
  if (options.input && !fs.existsSync(options.input)) {
    this.done(new Error("options.input file given but does not exist."));
  }
  if (this.validInputTypes.indexOf(options.inputType) === -1) {
    this.done(new Error("options.inputType, " + options.inputType + " not supported."));
  }

  // Check for stdin
  if (!options.input) {
    options.stdin = true;
  }

  // Get any data from data file
  this.data = {};
  if (this.options.id && this.options.dataPath && fs.existsSync(this.options.dataPath)) {
    this.data = JSON.parse(fs.readFileSync(this.options.dataPath, "utf-8"));
  }

  // Get info from input
  this.inputStats = this.inputStats || this.fileStat(this.options.input);

  // Title
  this.output.title("Tables");

  // Some binding.  Easier way to do this?
  _.bindAll(this, ["start", "parse", "insertBatch", "guessModel", "guessTableName",
    "fileStat", "bar", "inputParser", "dbConnect", "defaultDataPath", "saveData",
    "outputConfig", "done"]);

  // try to catch errors
  try {
    // Start if models defined, otherwise we need to guess
    if (options.models) {
      this.start();
    }
    else {
      this.guessModel();
    }
  }
  catch (e) {
    this.done(e);
  }
}

// Start (all options ready)
Tables.prototype.start = function() {
  // Connect to database
  this.output.heading("Database");
  this.output.item("Connecting to DB");
  this.dbConnect(_.bind(function() {
    this.output.item("Connected to DB");
    this.parse();
  }, this));
};

// Main parsing method
Tables.prototype.parse = function() {
  var thisTables = this;
  var bar = this.bar();
  var parsedCount = 0;
  var parsedByteCount = 0;
  var info = (this.data && this.data[this.options.id]) ? this.data[this.options.id] : undefined;
  var tickStart = 0;
  var tickStarted = false;
  var options = {};
  var persistentOptions;
  var b;
  var s;

  // Output head
  this.output.heading("Streaming");

  // Reset batch
  this.batch = [];

  // Attach autoparser; helpful for custom parsing
  this.autoParser = autoParser;

  // Create stream
  if (!this.options.stdin) {
    this.output.item("Streaming: " + this.options.input);

    // Check if we should start from middle.  Works for CSV for now, as JSON
    // requires a begninng string.  Or resumable set to true.  TODO: get JSON resume to work
    if (!this.options.restart && info && info.current && info.current < info.total &&
      (this.options.inputType === "csv" || this.options.resumable)) {
      options.start = parsedByteCount = info.current;
      options.end = info.total;
      this.options.inputOptions = _.defaultsDeep(info.inputOptions, this.options.inputOptions);
      tickStart = info.current;
    }

    // Create stream
    s = fs.createReadStream(this.options.input, options);
  }
  else {
    this.output.item("Streaming stdin");

    // Create stream from what was buffered
    b = new stream.PassThrough();
    b.end(Buffer.concat(this.guessBuffers));

    // Merge with anything that is left.
    s = b;
    if (!thisTables.guessStream.destroyed) {
      s = merge(b, thisTables.guessStream);
    }
  }

  // On streaming data, update bar and counts
  s.on("data", function(data) {
    parsedByteCount = parsedByteCount + data.length;
    bar.tick((!tickStarted) ? tickStart + data.length : data.length);
    tickStarted = true;
  });

  // On end, update output
  s.on("end", function() {
    if (!bar.complete) {
      bar.terminate();
    }

    thisTables.output.item("Streaming done");
  });

  // Handle error
  s.on("error", function(error) {
    thisTables.done(new Error(error));
  });

  // Add main parser
  s.pipe(this.inputParser())
    .on("data", function(data) {
      // To resume a stream, we need to save the headers
      persistentOptions = persistentOptions ||
        ((thisTables.options.inputType === "csv") ? { headers: _.keys(data) } : {});
      var parsed = data;

      // Parse with autoparser
      if (thisTables.options.autoparse) {
        parsed = autoParser(data, thisTables.options.models, {
          dateFormat: thisTables.options.dateFormat,
          datetimeFormat: thisTables.options.datetimeFormat
        });
      }

      // Check for custom parser
      if (_.isFunction(thisTables.options.parser)) {
        parsed = _.bind(thisTables.options.parser, thisTables)(parsed, data);
      }

      // In case of bad data
      if (!parsed) {
        return;
      }

      // Insert into database (as needed)
      thisTables.insertBatch(parsed, s, this, parsedByteCount, persistentOptions, false);

      // Track rows
      parsedCount++;
      if (bar.rows) {
        bar.rows(parsedCount);
      }
    })
    .on("end", function() {
      thisTables.insertBatch(null, s, this, parsedByteCount, persistentOptions, true);

      // Complete bar
      if (!bar.complete) {
        bar.terminate();
      }
      thisTables.output.item("Parsing done");
      thisTables.done(null);
    })
    .on("error", function(error) {
      thisTables.done(new Error(error));
    });
};

// Handle batch.  Split up batches into models
Tables.prototype.insertBatch = function(data, streamProcess, parseProcess, bytes, persistentOptions, force, done) {
  var q;
  var split = {};

  // Add to array
  if (data && !_.isArray(data)) {
    this.batch.push(data);
  }
  if (_.isArray(data) && data.length) {
    this.batch = this.batch.concat(data);
  }

  // First check if we should
  if (force || this.batch.length >= this.options.batchSize) {
    q = queue(1);
    parseProcess.pause();
    streamProcess.pause();

    // Split up models
    _.each(this.batch, function(b) {
      _.each(b, function(row, modelName) {
        split[modelName] = split[modelName] || [];
        split[modelName].push(row);
      });
    });

    // Queue up each model
    _.each(split, _.bind(function(b, modelName) {
      q.defer(dbUtils.bulkUpsert, this.db, this.models[modelName], b);
    }, this));

    // When done
    q.awaitAll(_.bind(function(error) {
      if (error) {
        this.done(new Error(error));
      }

      this.batch = [];
      this.saveData(bytes, persistentOptions);
      streamProcess.resume();
      parseProcess.resume();
    }, this));
  }
};

// Guess model
Tables.prototype.guessModel = function() {
  var thisTables = this;
  var guessCount = 0;
  var columns = {};
  var bar = this.bar();
  var exited = false;
  var tableName = utils.toSQLName(this.options.tableName) ||
    this.guessTableName(this.options.input) || "tables_import";
  var guess;

  // Title
  this.output.heading("Model guessing");
  this.output.item("No models options provided, guessing data structure and types from first " + this.options.guessLimit + " rows");

  // Start stream
  if (!this.options.stdin) {
    this.output.item("Streaming: " + this.options.input);
    guess = fs.createReadStream(this.options.input);
  }
  else {
    this.output.item("Streaming stdin");
    this.guessBuffers = [];
    guess = process.stdin;
  }

  // Create functions for streams so that we can remove them if needed
  var guessData = function(data) {
    if (thisTables.options.stdin) {
      thisTables.guessBuffers.push(data);
    }

    bar.tick(data.length);
  };
  guess.on("data", guessData);

  // Add main parser
  guess.pipe(this.inputParser())
    .on("data", function(data) {
      // Add to column list
      if (guessCount < thisTables.options.guessLimit) {
        _.each(data, function(d, di) {
          columns[di] = columns[di] || [];
          columns[di].push(d);
        });

        guessCount++;
      }
      else {
        // If we are reading from stdin, we don't want to destroy
        if (thisTables.options.stdin) {
          // Assign to object for reference
          thisTables.guessStream = guess;

          // Pause parser and stream
          this.pause();
          guess.pause();

          // Remove the data listener
          guess.removeListener("data", guessData);
          streamDone();
          unpipe(guess);
        }
        else {
          guess.destroy();
        }
      }
    });

  // Close means destroy has been called
  guess.on("close", streamDone);
  guess.on("end", streamDone);

  // When done
  function streamDone() {
    // Make sure only done once
    if (exited) {
      return;
    }
    exited = true;

    // Assign to object for reference
    thisTables.guessStream = guess;

    // Stop bar
    if (!bar.complete) {
      bar.terminate();
    }

    // Set options and start regular process
    thisTables.options.models = {};
    thisTables.options.models[tableName] = columnsToModel(columns, {
      key: thisTables.options.key,
      tableName: tableName,
      dateFormat: thisTables.options.dateFormat,
      datetimeFormat: thisTables.options.datetimeFormat
    });
    thisTables.output.item("Done guessing");

    if (thisTables.options.outputConfig) {
      thisTables.outputConfig();
    }
    else {
      thisTables.start();
    }
  }
};

// Guess table name from input
Tables.prototype.guessTableName = function(input) {
  var filename;

  // We may not have an input file name to go from
  if (!input) {
    return "tables_import";
  }

  filename = input.split("/").pop();
  return utils.toSQLName(filename.replace(/.[a-z]+$/, ""));
};

// Get info about input file
Tables.prototype.fileStat = function(file) {
  return file ? fs.statSync(file) : {};
};

// MAke progress bar based on input
Tables.prototype.bar = function() {
  var thisTables = this;
  var spinner;
  this.inputStats = this.inputStats || this.fileStat(this.options.input);

  // Only output if configured
  if (this.options.output) {
    if (this.inputStats.size) {
      return new ProgressBar(this.options.progress, _.extend(this.options.progressOptions, {
        total: this.inputStats.size
      }));
    }
    else {
      spinner = new Spinner(this.output.spinnerFormat);
      spinner.tick = function() { return; };
      spinner.rows = function(rows) {
        if (rows && rows % thisTables.options.batchSize === 0) {
          spinner.stop(true);
          spinner.setSpinnerTitle(thisTables.output.spinnerFormat + " " + rows + " rows");
          spinner.start();
        }
      };
      spinner.terminate = function() {
        spinner.stop(true);
      };
      spinner.complete = false;
      spinner.start();
      return spinner;
    }
  }
  else {
    return {
      tick: function() { return; },
      terminate: function() { return; },
      complete: true
    };
  }
};

// Make input parser
Tables.prototype.inputParser = function() {
  var type = this.options.inputType;
  var options = this.options.inputOptions;

  // If the type is explicitly "custom", use custom pipe
  if (type === "custom") {
    this.output.item("Parser: custom");
    return this.options.pipe;
  }

  this.output.item("Parser: " + this.options.inputType);
  return tito.formats.createReadStream(type, options);
};

// Make sequelize connection
Tables.prototype.dbConnect = function(done) {
  var dbOptions = {
    pool: {
      maxIdleTime: 10000
    }
  };

  // If no connection is provide, use the file name and sqlite
  if (!this.options.db) {
    this.options.db = this.options.input ? "sqlite://" + this.options.input
      .replace(".csv", "")
      .replace(".json", "") + ".sql" :
      "sqlite://tables-import.sql";
  }

  // URI possibilities
  // mariadb://root:@localhost:3306/db_store
  // mysql://root:thing@localhost:3306/db_store
  // pgsql://root:thing@localhost/db_store
  // sqlite://path/to/file.sql
  this.dbConnectionConfg = url.parse(this.options.db);

  // Make options based on protocol
  if (this.dbConnectionConfg.protocol.toLowerCase().indexOf("mysql") === 0 ||
    this.dbConnectionConfg.protocol.toLowerCase().indexOf("mariadb") === 0) {
    dbOptions.dialectOptions = {
      multipleStatements: true
    };
  }
  else if (this.dbConnectionConfg.protocol.toLowerCase().indexOf("pgsql") === 0) {
    dbOptions.dialectOptions = {
      multipleStatements: true
    };
  }
  else if (this.dbConnectionConfg.protocol.toLowerCase().indexOf("sqlite") === 0) {
    dbOptions.storage = this.dbConnectionConfg.hostname +
      (this.dbConnectionConfg.path ? this.dbConnectionConfg.path : "");
  }

  // Allow for people to override options
  dbOptions = _.defaultsDeep(this.options.dbOptions || {}, dbOptions);

  // Connect
  this.db = new Sequelize(this.options.db, dbOptions);

  // Set up models
  _.each(this.options.models, _.bind(function(model, tableName) {
    model.tableName = model.tableName || tableName;
    model.modelName = model.modelName || utils.toModelName(tableName);
    this.models = this.models || {};
    this.models[model.modelName] = this.db.define(tableName, model.fields, _.extend({
      underscored: true,
      freezeTableName: true,
      tableName: tableName
    }, model.options));
  }, this));

  // Sync (create tables).  Warn if forcing
  if (this.options.restart) {
    this.output.warn("Restarting removes any existing data and tables.  Waiting 3 seconds.");
    setTimeout(_.bind(function() {
      this.db.sync({ force: this.options.restart }).then(_.bind(function() {
        // On SQLite, vaccum can save a lot of space.
        dbUtils.vacuum(this.db, done);
      }, this));
    }, this), 3000);
  }
  else {
    this.db.sync({ force: this.options.restart }).then(done);
  }
};

// Make default data path
Tables.prototype.defaultDataPath = function() {
  return path.join(process.env[(process.platform === "win32") ? "USERPROFILE" : "HOME"], ".tables-data");
};

// Save data
Tables.prototype.saveData = function(bytes, options) {
  this.inputStats = this.inputStats || this.fileStat(this.options.input);

  if (this.options.id && this.options.dataPath) {
    // Update data info
    this.data[this.options.id] = {
      current: bytes,
      total: this.inputStats.size,
      inputOptions: options
    };

    // Save file
    fs.writeFileSync(this.options.dataPath, JSON.stringify(this.data));
  }
};

// OutputConfig
Tables.prototype.outputConfig = function() {
  this.output.item("Output config");
  var formatted = _.cloneDeep(this.options);

  // Don't output if configed so
  if (!this.options.output) {
    return;
  }

  // Go through model types
  _.each(this.options.models, function(model, mi) {
    _.each(model.fields, function(field, fi) {
      formatted.models[mi].fields[fi].type = "new Sequelize." +
        field.type.key + "(" +
        (field.type.options ? JSON.stringify(field.type.options) : "") + ")";
    });
  });

  // Try to make a bit more friendly
  this.output.log(JSON.stringify(formatted, null, "  ")
    .replace(/"new Sequelize\.(.*)\((.*)\)"/g,
    function(match, p1, p2) {
      return "new Sequelize." + p1 + "(" + p2.replace(/\\"/g, "") + ")";
    }));
};

// A general handler for errors or done
Tables.prototype.done = function(error, message) {
  message = message || "";

  // Handle errors.  Allow for custom function.
  if (error && _.isFunction(this.options.errorHandler)) {
    this.options.errorHandler(error);
  }
  else if (error) {
    throw error;
  }
  else {
    this.output.log(message + " \n");
  }
};

// Export
module.exports = Tables;
