# Tables

Tables is a simple command-line tool and powerful library for importing data like a CSV or JSON file into relational database tables.  The goal is to make data import easy, configurable, and stable for large datasets into a relational database for better analysis.

[![Build Status](https://travis-ci.org/datanews/tables.svg?branch=master)](https://travis-ci.org/datanews/tables) [![Dependencies](https://david-dm.org/datanews/tables.svg)](https://david-dm.org/datanews/tables)
[![License](https://img.shields.io/npm/l/tables.svg)]()

## Install

* To include as a library: `npm install tables`
* To use as a command-line tool: `npm install -g tables`

## Features

* Automatic data type guessing.
* Automatic indexes guessing.
* Efficient memory utilizing Node streams.
* Supports CSV-ish, JSON, NDJSON, and HTML table data sources (utilizes [tito](https://github.com/shawnbot/tito)).
* Default use of SQLite so no need to setup a database server.
* Resumable (currently only works for CSV in input mode).
* Sane defaults.
* Supports MySQL, Postgres, and SQLite.
    * *Note*: Postgres has some limitations, specific with updating data.
* Verbose, structured output.

## Command line use

The command line version can handle most of the simple options that the library uses.  A simple example that will read in a CSV and create an SQLite database at `examples/nyc-water-quality-complaints.sql` with a `nyc_water_quality_complaints` table with the converted data.

```bash
tables -i examples/nyc-water-quality-complaints.csv
```

### Options

Use the `--help` option to get a full, up-to-date look at what the options are, but here are most of them for reference:

* `--help`: Shows help message.
* `--version`: Outputs version.
* `--input`: The input file to use.  Tables also can use a piped in source as well, if this is not provided.
* `--db`: The database URI to push data into.  By default, Tables will use the input option to create a SQLite database with the same path with a `.sql` extension, or for piping, it will create an SQLite database name `tables-import.sql` where the command is run.  If you are using a password to access your database please consider using the  `TABLES_DB_URI` environment variable for security reasons.  Examples:
    * `--db="sqlite://./my-new-db.sql"`
    * `--db="mysql://username:password@localhost/my-database"`
    * `--db="postgres://username:@localhost:1234/my-database"`
* `--key`: Creates a unique key from columns if the models options in config is not provided.  This is a **suggested option** as it allows for data to be updated as opposed to being added to.  You can use a comma-delimited list of columns for a multi-column key, like "column 1,other,thing".  Do note that this option only works if not manually defining the model, specifically in a config file.
* `--table-name`: Specify name of table importing into.  By default, Tables uses the file name.  Do note that this option only works if not manually defining the model, specifically in a config file.
* `--silent`: No output except errors.
* `--data`: Path to data file for resuming streams.  Defaults to ~/.tables-data.
* `--id`: ID to use for resuming stream; if an input file is provided, the filename is used by default.
* `--restart`: Restart any resuming as well as remove existing data and tables.  **WARNING: DELETES DATA**  Use this is you don't have a unique key defined or if your model has changed.
* `--batch-size`: Numbers of rows to import at once. Default is 1000.  Use lower or higher numbers depending the database and how it is configured.
* `--guess-limit`: Numbers of rows to analyze for data structure and types. Default is 1000.  Use a higher number than the default if your data have many inconsistencies.
* `--type`: Force type of parsing.  This is determined from filename and defaults to `csv`.  Valid values are `csv`, `tsv`, `json`, `ndjson`, `html`, or `custom`.
* `--csv-headers`: Use the keyword, false, if there are no headers. Or use a comma separated list of headers. Defaults to reading headers from file.  Forces type to CSV.
* `--csv-delimiter`: CSV delimiter character.  Defaults to `,`.  If you need to use a tab character, use `--csv-delimiter=$'\t'`.  Forces type to CSV.
* `--csv-quote`: CSV quote character.  Defaults to `"`.  Forces type to CSV.
* `--json-path`: JSON path to use for parsing rows. Default is `*`.  See [JSONStream](https://github.com/dominictarr/JSONStream).  Forces type to CSV.
* `--html-selector`: CSS selector to target specific table when using the `html` type.
* `--date-format`: Date format to use when guessing date columns and parsing data.  Defaults to `MM/DD/YYYY`.  See [moment.js](http://momentjs.com/docs/) for options.
* `--datetime-format`: Datetime format to use when guessing date columns and parsing data.  Defaults to `MM/DD/YYYY HH:mm:ss a`.  See [moment.js](http://momentjs.com/docs/) for options.
* `--config`: Allows to use a JS file that exports configuration for Tables.  Any other options will override the values in the file.  This allows for options that are not easily supported on a command line.  See Options section under Library Use.

### Piping

Piping in data is supported.  It should be noted that a couple things happen with piping.  A bit more memory is used if guessing models.  A progress bar with time estimate cannot be used since we can't know how much data is in total.  Without an input file and certain options not defined, the default SQLite file will be `tables-import.sql` and table name of `tables_import`.

### Examples

Get data from the NYC Data Portal about water quality complaints and then create an SQLite database of the same name.  This will create `examples/nyc-water-quality-complaints.sql` with a `nyc_water_quality_complaints` table that has all the data.

```bash
wget "https://data.cityofnewyork.us/api/views/qfe3-6dkn/rows.csv?accessType=DOWNLOAD" -O examples/nyc-water-quality-complaints.csv;
tables -i examples/nyc-water-quality-complaints.csv;
```

Put my Github followers into an SQLite database named `github.sql` and table name `followers`:

```bash
curl --silent https://api.github.com/users/zzolo/followers | tables --type=json --db="sqlite://./examples/github.sql" --table-name=followers --key="id";
```

Or use the Twitter command line tool, [t](https://github.com/sferik/t), to save your timeline to a database.

```bash
t timeline -n 1000 --csv | tables --db="sqlite://examples/twitter.sql" --table-name=timeline --datetime-format="YYYY-MM-DD HH:mm:ss Z" --key="id"
```

The following are examples of getting [FEC campaign finance data](http://www.fec.gov/finance/disclosure/ftpdet.shtml) and putting them into a MySQL database named `fec`.  In this example the `id` flag is not useful for piping data, but helps us keep track which statement is which.

```bash
curl --silent ftp://ftp.fec.gov/FEC/2016/cm16.zip | funzip | \
tables --id="fec-committee-master" --csv-delimiter="|" \
--csv-headers="CMTE_ID,CMTE_NM,TRES_NM,CMTE_ST1,CMTE_ST2,CMTE_CITY,CMTE_ST,CMTE_ZIP,CMTE_DSGN,CMTE_TP,CMTE_PTY_AFFILIATION,CMTE_FILING_FREQ,ORG_TP,CONNECTED_ORG_NM,CAND_ID" \
--key="CMTE_ID" --table-name="fec_committees" \
--db="mysql://root:@127.0.0.1/fec";

curl --silent ftp://ftp.fec.gov/FEC/2016/cn16.zip | funzip | \
tables --id="fec-candidate-master" --csv-delimiter="|" \
--csv-headers="CAND_ID,CAND_NAME,CAND_PTY_AFFILIATION,CAND_ELECTION_YR,CAND_OFFICE_ST,CAND_OFFICE,CAND_OFFICE_DISTRICT,CAND_ICI,CAND_STATUS,CAND_PCC,CAND_ST1,CAND_ST2,CAND_CITY,CAND_ST,CAND_ZIP" \
--key="CAND_ID" --table-name="fec_candidates" \
--db="mysql://root:@127.0.0.1/fec";

curl --silent ftp://ftp.fec.gov/FEC/2016/indiv16.zip | funzip | \
tables --id="fec-indiv-contributions" --csv-delimiter="|" \
--csv-headers="CMTE_ID,AMNDT_IND,RPT_TP,TRANSACTION_PGI,IMAGE_NUM,TRANSACTION_TP,ENTITY_TP,NAME,CITY,STATE,ZIP_CODE,EMPLOYER,OCCUPATION,TRANSACTION_DT,TRANSACTION_AMT,OTHER_ID,TRAN_ID,FILE_NUM,MEMO_CD,MEMO_TEXT,SUB_ID" \
--key="SUB_ID" --table-name="fec_indiv_contributions" --date-format="MMDDYYYY" \
--batch-size=2000 --db="mysql://root:@127.0.0.1/fec";
```

The NY Board of Election's campaign finance data comes in a CSV sort of format, but it requires some custom parsing.  This configuration uses its own pipe function.

```bash
wget http://www.elections.ny.gov/NYSBOE/download/ZipDataFiles/ALL_REPORTS.zip -O examples/ny-ALL_REPORTS.zip;
unzip examples/ny-ALL_REPORTS.zip -d examples/ny-ALL_REPORTS;
tables -i examples/ny-ALL_REPORTS/ALL_REPORTS.out -d "mysql://root:@localhost/ny_campaign_finance" --config=examples/ny-campaign-finance.conf.js;
```

Since Tables uses [tito](https://github.com/shawnbot/tito) to get table data, we can also easily import HTML tables straight from the page:

```bash
curl --silent "http://www.presidentsusa.net/presvplist.html" | tables -t html -d "sqlite://./examples/presidents.sql" -n "presidents";
```

Or a list of all the Disney movies:

```bash
curl --silent "http://www.thecompletistgeek.com/wp/" | tables -t html -d "sqlite://./examples/disney.sql" -n "movies" -m 'table.easy-table' -a "YYYY/MM/DD";
```

USASpending.gov has a [contract database](https://www.usaspending.gov/DownloadCenter/Pages/dataarchives.aspx) that is a 2G csv that has 900k+ rows and 200+ columns.  It's also not very good data in the sense that its structure and formatting is not consistent.  *This does not fully work well as there are rows that do not parse correctly with the CSV parser.*

```bash
wget "http://download.usaspending.gov/data_archives/201603/csv/2016_All_Contracts_Full_20160315.csv.zip" -O examples/2016_All_Contracts_Full_20160315.csv.zip;
unzip examples/2016_All_Contracts_Full_20160315.csv.zip -d examples/;
tables -i "examples/datafeeds/2016_All_Contracts_Full_20160315.csv" \
-d "mysql://root:@localhost/tables-testing" --batch-size=500 \
--config=examples/usa-spending-contracts.conf.js
```

## Library use

Include like most libraries:

```js
var Tables = require("tables");
```

Import in a CSV file:

```js
var t = new Tables({
  input: "./tests/data/nyc-water-quality-complaints.csv"
});
```

### Options

* `models`: This is how the database tables are defined.  If this is left empty, Tables will try to guess this from some of the data.  Data types are the types supported by [Sequelize](http://sequelize.readthedocs.org/en/latest/api/datatypes/).  This should be an object like the following:  
```js
  {
    "modelName": {
      tableName: "table_name",
      // Fields are the same field definitions for Sequelize with a couple extra parts
      // See: http://sequelize.readthedocs.org/en/latest/docs/models-definition/
      fields: {
        field1: {
          // Input field.  Used for auto-parsing
          input: "Field 1",
          // The new name
          name: "field1",
          // Sequelize type
          type: new Sequelize.String(64)
        },
        field_number: {
          input: "Some Number Fld",
          name: "field_number",
          type: new Sequelize.BIGINT
        }
      },
      // Options for defining a Sequelize model
      // See: http://sequelize.readthedocs.org/en/latest/docs/models-definition/#configuration
      options: {
        indexes: [
          {
            fields: ["field1", "field_number"],
            unique: true
          }
        ]
      }
    },
    "anotherModel": {
      tableName: "another_table",
      ...
    }
  }
```
* `dbOptions`: Tables uses [Sequelize](http://sequelize.readthedocs.org/) as its ORM to more easily support multiple database backends.  This options is an object that goes into `new Sequelize(uri, options)`.  The default of this will change a bit depending on what database is used.
* `inputOptions`: Options to pass to the stream parser.  This will depend on what `inputType` option is given and the defaults change on that as well.  See [tito](https://github.com/shawnbot/tito) for full options.
    * The CSV parser is [fast-csv](https://github.com/C2FO/fast-csv)
    * The JSON parser is [JSONstream](https://github.com/dominictarr/JSONStream) and should be in a format like `{ path: "*" }`.
    * The HTML table parser can use a CSS selector to get the table with some like `{ selector: ".table" }`
* `parser`: Custom parser function.  Takes two arguments: the first is the "row" of auto-parsed data, and second is the "row" of the original data from the pipe (CSV, JSON, custom, etc).
* `autoparse`: Boolean.  Turn off or on the auto-parsing of the piped data.  This happens before the `parse` function.
* `pipe`: A custom pipe function such as [byline](https://www.npmjs.com/package/byline).
* `resumable`: Boolean to attempt to be make the import resumable.  Only really necessary if using a custom `pipe` that can support this.

The following are all options that correspond to command-line options; see that section for more description.

* `input`: `--input`, path to file.
* `inputType`: `--type`, string, see valid values above.
* `db`: `--db`, DB URI.  This can be provided with the `TABLES_DB_URI` environment variable.  Examples:
    * `sqlite://./path/to/db.sql`
    * `mysql://username:password@localhost:3306/database`
    * `postgres://username:password@localhost:5432/database`
* `tableName`: `--table-name`, string.  This is only used if the `models` configuration is not provided.
* `key`: `--key`, string.  This is only used if the `models` configuration is not provided.
* `id`: `--id`, string.
* `restart`: `--restart`, boolean.
* `batchSize`: `--batch-size`, integer.
* `dataPath`: `--data`, path to file.
* `dateFormat`: `--date-format`, string.
* `datetimeFormat`: `--datetime-format`, string.
* `output`: Opposite of `--silent`, boolean.
* `errorHandler`: A custom function to run when errors are thrown.  Gets passed the error.  Mostly used for the command line tool.

## Troubleshooting

* If you see an error like `Cannot find module '[..]/node_modules/sqlite3/lib/binding/node-v47-darwin-x64/node_sqlite3.node'`, you may want to switch versions of node to get the sqlite module to work (try [n](https://www.npmjs.com/package/n) to manage multiple versions).

## Tests

Tests are run through mocha; after a `npm install`, do the following:

```bash
npm run test
```

## Publishing

1. Update `package.json` with the new version.
1. `git tag X.X.X`
1. `git push origin master --tags`
1. `npm publish`
