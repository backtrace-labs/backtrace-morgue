# morgue

## Installation

It is recommended to install `morgue` using `npm`.

```
npm install backtrace-morgue -g
```

If you working from the repository, then instead use the following command.
```
npm install -g
```

This will install the `morgue` tool in your configured path. Refer to the
`morgue --help` command to learn more.

## Introduction

`morgue` is a command-line interface to the Backtrace object store. It allows
you to upload, download and issue queries on objects with-in the object store.

## Usage

### login

```
Usage: morgue login <url>
```

The first step to using `morgue` is to log into a server.

```
$ morgue login http://localhost
User: sbahra
Password: **************

Logged in.
```

At this point, you are able to issue queries.

### clean

Retroactively apply sampling on a fingerprint. The default is to keep
3 objects retained for every fingerprint. This is configurable. Also
configurable is keeping the oldest N objects for every fingerprint.

```
Usage: morgue clean <[<universe>/]project> [--keep=N] [--oldest=N] [<query filter>] [--verbose] [--output]
```

If --output is set, then all object identifiers are output to stdout. Statistics
are output to stderr. It is then possible to chain this into morgue delete:

```
$ morgue clean blackhole --output > file.txt
$ cat file.txt | xargs -n 8192 morgue delete blackhole --physical-only
```

### describe

```
Usage: morgue describe <[<universe>/]project> [substring]
```

Requests a list and description of all metadata that can be queried against.

#### Example

```
$ morgue describe bidder uname
              uname.machine: machine hardware name
              uname.release: kernel release
              uname.sysname: kernel name
              uname.version: kernel version
```

### get

```
Usage: morgue get <[<universe>/]project> [options] <object id> [-o <output file>]
```

Downloads the specified object from the Backtrace object store and prints
to standard output. Optionally, output the file to disk.

The following options are available:

| Option        | Description |
|---------------|-------------|
| `--resource=name`| Fetch the specified resource rather than the object. |

### put

```
Usage: morgue put <[<universe>/]project> <file> <--format=btt|minidump|json|symbols> [options]
```

Uploads object file to the Backtrace object store. User has the following options

| Option        | Description |
|---------------|-------------|
| `--compression=gzip|deflate`| uploaded file is compressed |
| `--kv=key1:value1,key2:value2,...`| upload key-values |
| `--form_data`| upload file by multipart/form-data post request |

### set 

```
Usage: morgue set <[universe/]project> <query> <key>=<value>
```

Modifies attributes of the given object in the manner specified.
Both options below may be specified more than once.

You are also able to modify multiple objects by specifying filters. The
`--filter`, `--age` and `--time` arguments are accepted to modify. You
must specify some filter criteria.

#### Example

Set custom attribute `reason` to `oom` for all crashes containing `memory_abort`.

```
$ morgue set reason=oom --filter=callstack,regular-expression,memory_abort
```

Set `reason` to `boomboom` for object `cb`.

```
$ morgue set reason=boomboom --filter=_tx,equal,206
```

### attachment

```
Usage: morgue attachment <add|get|list|delete> ...

  morgue attachment add [options] <[universe/]project> <oid> <filename>

    --content-type=CT    Specify Content-Type for attachment.
                         The server may auto-detect this.
    --attachment-name=N  Use this name for the attachment name.
                         Default is the same as the filename.

  morgue attachment get [options] <[universe/]project> <oid>

    Must specify one of:
    --attachment-id=ID   Attachment ID to delete.
    --attachment-name=N  Attachment name to delete.

  morgue attachment list [options] <[universe/]project> <oid>

  morgue attachment delete [options] <[universe/]project <oid>

    Must specify one of:
    --attachment-id=ID   Attachment ID to delete.
    --attachment-name=N  Attachment name to delete.
```

Manage attachments associated with an object.

### list

Allows you to perform queries on object metadata. You can perform
either selection queries or aggregation queries, but not both at the
same time.

```
Usage: morgue list <[<universe>/]project> [substring]
```

You may pass `--verbose` in order to get more detailed query performance
data.

The `--csv=<output file>` option may be passed in with a specified output
file to output results to a CSV file instead. This may only be used with
`--select` queries.

#### Filters

The filter option expects a comma-delimited list of the form
`<attribute>,<operation>,<value>`.

The currently supported operations are `equal`, `regular-expression`,
`inverse-regular-expression`, `at-least`, `greater-than`, `at-most`,
`less-than`, `contains`, `not-contains`, `is-set`, and `is-not-set`.

#### Pagination

Pagination is handled with two flags

`--limit=<n>` controls the number of returned rows. `--offset=<n>` controls the
offset at which rows are returned, another way to put it is that it skips the
first `<n>` rows.

#### Aggregations

Aggregation is expressed through a myriad of command-line options that express
different aggregation operations. Options are of form `--<option>=<attribute>`.

The ``*`` factor is used when aggregations are performed when no factor is
specified or if an object does not have a valid value associated with the
factor.

| Option           | Description |
|------------------|-------------|
| `--age`          | Specify a relative timestamp to now. `1h` ago, or `1d` ago. |
| `--time`         | Specify a range using [Chrono](https://github.com/wanasit/chrono#readme). |
| `--unique`       | provide a count of distinct values |
| `--histogram`    | provide all distinct values |
| `--distribution` | provide a truncated histogram |
| `--mean`    	   | calculate the mean of a column |
| `--sum`          | sum all values |
| `--range`        | provide the minimum and maximum values |
| `--count`        | count all non-null values |
| `--bin`          | provide a linear histogram of values |
| `--head`         | provide the first value in a factor |
| `--tail`         | provide the last value in a factor |
| `--object`       | provide the maximum object identifier of a column |

#### Sorting

Sorting of results is done with the stackable option `--sort=<term>`. The term
syntax is `[-](<column>|<fold_term>)`.

- The optional `-` reverse the sort term order to descending, otherwise it
  defaults to ascending.
- The `<column>` term refers to a valid column in the table. This is only
  effective for selection type query, i.e. when using the `--select` option.
- The `<fold_term>` is an expression pointing to a fold operation. The
  expression language for fold operation is one of the following literal:
    - `;group`: sort by the group key itself.
    - `;count`: sort by the group count (number of crashes).
    - `column;idx`: where `column` is a string referencing a column in the fold
      dictionary and `idx` is an indice in the array. See examples .

Multiple sort terms can be provided to break ties in case the previous
referenced sort term has ties.

#### Computed Views

Coronerd offers support for a limited set of computed columns which can be
used in selection and aggregation stages of a query.

##### `--quantize-uint`

Forms:

```
--quantize-uint output_column,input_column,size
--quantize-uint output_column,input_column,size,offset
```

Computes `( column + offset ) / size - offset` using integer math.  Used for
data alignment and rounding.

Size and offset may be integers or time units: `3600` and `1h` are both valid.

Typically size is a bin size and offset is a timezone offset from UTC.

For example, errors by day in EDT:

```
morgue list project --count fingerprint --factor timestamp.edt.day --head timestamp.edt.day --quantize-uint timestamp.edt.day,timestamp,1d,-4h
```

#### Example

Request all faults from application deployments owned by jdoe.
Provide the timestamp, hostname, callstack and classifiers.

```
$ morgue list bidder --filter=tag_owner,equal,jdoe --select=timestamp --select=hostname --select=callstack --select=classifiers
*
#9d33    Thu Oct 13 2016 18:36:01 GMT-0400 (EDT)     5 months ago
  hostname: 2235.bm-bidderc.prod.nym2
  classifiers: abort stop
  callstack:
    assert ← int_set_union_all ← all_domain_lists ←
    setup_phase_unlocked ← bid_handler_slave_inner ← bid_handler_slave ←
    an_sched_process_task ← an_sched_slave ← event_base_loop ←
    an_sched_enter ← bidder_slave ← an_sched_pthread_cb
#ef2f    Thu Oct 13 2016 18:36:01 GMT-0400 (EDT)     5 months ago
  hostname: 2066.bm-impbus.prod.nym2
  classifiers: abort stop
  callstack:
    assert ← an_discovery_get_instances ← budget_init_discovery ←
    main
#119bf   Thu Oct 13 2016 18:36:01 GMT-0400 (EDT)     5 months ago
  hostname: 2066.bm-impbus.prod.nym2
  classifiers: abort stop
  callstack:
    assert ← an_discovery_get_instances ← budget_init_discovery ←
    main
```

Request faults owned by jdoe, group them by fingerprint and aggregate
the number of unique hosts, display a histogram of affected versions and
provide a linear histogram of process age distribution.

```
$ morgue list bidder --age=1y --factor=fingerprint --filter=tag_owner,equal,jdoe --head=callstack --unique=hostname --histogram=tag --bin=process.age
823a55fb15bf697ba3041d736ade... ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁█▁▁▁▁▁▁▁▁▁▁▁▁ 5 months ago
Date: Wed May 18 2016 18:44:35 GMT-0400 (EDT)
callstack:
    assert ← int_set_union_all ← all_domain_lists ←
    setup_phase_unlocked ← bid_handler_slave_inner ← bid_handler_slave ←
    an_sched_process_task ← an_sched_slave ← event_base_loop ←
    an_sched_enter ← bidder_slave ← an_sched_pthread_cb
histogram(tag):
  8.20.4.adc783.0 ▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆ 1
unique(hostname): 1
bin(process.age):
          7731         7732 ▆▆▆▆▆▆▆▆▆▆ 1

3b851ac1ab1421409159cc38edb2... ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁█▁▁▁▁▁▁▁▁▁▁▁▁▁ 5 months ago
Date: Tue May 17 2016 17:28:26 GMT-0400 (EDT)
      Tue May 17 2016 17:30:07 GMT-0400 (EDT)
callstack:
    assert ← an_discovery_get_instances ← budget_init_discovery ←
    main
histogram(tag):
  4.44.0.adc783.1 ▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆ 2
unique(hostname): 1
bin(process.age):
            23           24 ▆▆▆▆▆▆▆▆▆▆ 1
            24           25 ▆▆▆▆▆▆▆▆▆▆ 1
```

Request faults for the last 2 years, group them by fingerprint, show the first
object identifier in the group, sort the results by descending fingerprint,
limit the results to 5 faults and skip the first 10 (according to sort order).

```
$ morgue list blackhole --age=2y --factor=fingerprint --object=fingerprint --limit=5 --offset=10 --sort="-;group"
fec4bfecf8e077cf44024f5668fa... ▁▁▁█▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁ 2 years ago
First Occurrence: Tue Jan 12 2016 13:30:12 GMT-0500 (EST)
     Occurrences: 360
object(fingerprint): 1c653d

fe7294a780a16e30b619e8d94a8a... █▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁ 2 years ago
First Occurrence: Wed Oct 28 2015 11:30:47 GMT-0400 (EDT)
 Last Occurrence: Wed Oct 28 2015 12:16:19 GMT-0400 (EDT)
     Occurrences: 203
object(fingerprint): 1c23b3

fe5e0dda6cf0fb996a521dde4087... ▁▁▁▁▁▁▁▁▁▁█▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁ 1 year ago
First Occurrence: Tue Jun 14 2016 11:54:35 GMT-0400 (EDT)
     Occurrences: 1
object(fingerprint): 2de5

fe46d9af7c65c084091fed51ef02... █▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁ 2 years ago
First Occurrence: Tue Oct 27 2015 16:59:34 GMT-0400 (EDT)
 Last Occurrence: Tue Oct 27 2015 20:05:30 GMT-0400 (EDT)
     Occurrences: 3
object(fingerprint): 8f41

fdc0860ef6dfd3d0397b53043ab9... ▁▁▁▁▁▁▁▁▁▁█▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁ 1 year ago
First Occurrence: Tue Jun 07 2016 11:51:55 GMT-0400 (EDT)
     Occurrences: 211
object(fingerprint): 1c1958
```

Request faults for the two years, group them by fingerprint, sum process.age,
sort the results by descending sum of process.age per fingerprint, limit the
results to 3 faults. Note here that `1` in `-process.age;1` is the second
operator (`--sum`) in this case.

```
$ morgue list blackhole --age=2y --factor=fingerprint --first=process.age --sum=process.age --limit=3 --sort="-process.age;1"
d9358a6fdb7eaa143254b6987d00... ▁▁▁▁▁▁▁▁▁▁▁▁▁▁█▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁ 1 year ago
First Occurrence: Tue Sep 20 2016 21:59:46 GMT-0400 (EDT)
 Last Occurrence: Tue Sep 20 2016 22:03:23 GMT-0400 (EDT)
     Occurrences: 38586
sum(process.age): 56892098354615 sec

524b9f988c8ff9dfc1b3a0c71231... ▁▁▁▁▁▁▁▁▁▁▁▁▁▁█▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁ 1 year ago
First Occurrence: Tue Sep 20 2016 22:01:52 GMT-0400 (EDT)
 Last Occurrence: Tue Sep 20 2016 22:03:19 GMT-0400 (EDT)
     Occurrences: 25737
sum(process.age): 37947233900547 sec

bffd05c6b745229fd1c648bbe2a7... ▁▁▁▁▁▁▁▁▁▁▁▁▁▁█▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁ 1 year ago
First Occurrence: Tue Sep 20 2016 21:59:46 GMT-0400 (EDT)
 Last Occurrence: Tue Sep 20 2016 22:03:01 GMT-0400 (EDT)
     Occurrences: 20096
sum(process.age): 29630010305216 sec
```

### delete

Allows deleting objects.

```
Usage: morgue delete <[universe/]project> <oid1> [... oidN]
```

Object IDs must be specified; they can be found in `morgue list` output.
The object ID printed in the example above is `9d33`.

By default, this command (as of 2019-02-26) requests physical-only deletion,
which retains only indexing.  The previous `--physical-only` argument is a
no-op.  The following options affect this behavior:
`--all`: Delete all related data, including indexing.
`--crdb-only`: Only delete the indexed data; requires physically deleted objects.

### flamegraph

```
Usage: morgue flamegraph <[universe/]project> [--filter=<filter expression>] [--reverse] [--unique] [-o file.svg]
```

Generate a flamegraph of callstacks of all objects matching the specified
filter criteria. The `--filter` option behaves identically to the `list`
sub-command. This functionality requires `perl` to be installed.
To learn more about flamegraphs, please see
http://www.brendangregg.com/flamegraphs.html.

Use `--unique` to only sample unique crashes. Use `--reverse` to begin sampling
from leaf functions.



### symbold

Manage Backtrace symbold service

```
Usage: morgue symbold <symbolserver | whitelist | blacklist | skiplist | status> <action>
```


#### status
Return Symbold service status for <[universe]/project>
```
Usage: morgue symbold status <[universe]/project>
```

#### symbolserver
Symbol server allows you to manage symbol servers used by symbold

#### list
List Symbold symbol server assigned to <[universe]/project>
```
Usage: morgue symbold symbolserver list <[universe]/project>
```
Example:
```
$ morgue symbold symbolserver list backtrace
```

#### details
Retruns detailed information about symbol server
```
Usage: morgue symbold symbolserver details [symbolserverid]
```

Example:
```
$ morgue symbold symbolserver details 1
``` 
Command line above will return detailed information for symbol server with id 1

#### logs
Returns symbol server logs. You can use page and take arguments to get more/less logs.
```
Usage: morgue symbold symbolserver logs [symbolserverid]
```

Example:
```
$ morgue symbold symbolserver logs 1 --take=100 --page=0
```
Command above will return first 100 logs from page 0

#### filter logs
Returns filtered symbol server logs. By using this command you can filter all logs that match your criteria.
```
Usage morgue symbold symbolserver logs [symbolserverid] filter [filter]
```

Example:
```
morgue.js symbold symbolserver logs 5 filter a --take=100 --page=1
```
#### add
```
Usage: morgue symbold symbolserver add <[universe]/project> [symbolserverurl] 
  <--name=...>
  <--concurrentdownload=...>
  <--retrylimit=...>
  <--timeout=...>
  <--whitelist=...>
  <--servercredentials.username=...>
  <--servercredentials.password=...>
  <--aws.accesskey=...>
  <--aws.secret=...>
  <--aws.bucketname=...>
  <--aws.lowerfile=...>
  <--aws.lowerid=...>
  <--aws.usepdb=...>
  <--proxy.host=...>
  <--proxy.port=...>
  <--proxy.username=...>
  <--proxy.password=...>
```
Add new symbol server to symbold service. Available options:
* `name` - symbol server name,
* `concurrentdownload` - maximum number of concurrent download that symbolmd will do at the same time,
* `timeout` - download timeout
* `whitelist` - determine if symbol server should use whitelist or not,
* `servercredentials` - symbol server auth options
* `servercredentials.username` - symbol server auth user name,
* `servercredentials.password` - symbol server auth password,
* `aws.accesskey` - AWS S3 access key
* `aws.secret` - AWS S3 secret
* `aws.bucketname` - AWS S3 bucket name
* `aws.lowerfile` - determine if symbold should use lower case symbol name
* `aws.lowerid` - - determine if symbold should use lower case debug id
* `aws.usepdb` - determine a way to generate url to S3 symbols
* `proxy.host` - proxy host
* `proxy.port` - proxy port
* `proxy.username` - proxy username
* `proxy.password` - proxy password


Example:
```
$ morgue symbold symbolserver backtrace https://symbol.server.com --name=name --timeout=400
```

#### update
```
Usage: morgue symbold symbolserver update [symbolserverid] 
  <--url=...>
  <--name=...>
  <--concurrentdownload=...>
  <--retrylimit=...>
  <--timeout=...>
  <--whitelist=...>
  <--servercredentials.username=...>
  <--servercredentials.password=...>
  <--aws.accesskey=...>
  <--argv.aws.secret=...>
  <--argv.aws.bucketname=...>
  <--argv.aws.lowerfile=...>
  <--argv.aws.lowerid=...>
  <--argv.aws.usepdb=...>
  <--argv.proxy.host=...>
  <--argv.proxy.port=...>
  <--argv.proxy.username=...>
  <--argv.proxy.password=...>
```
Update  symbol server with id [symbolServerId]. If aws, proxy and servercredentials data doesn't exists symbold will ignore update server credentials. If any of them exists, symbold will try to update all properties.
Example:
```
$ morgue symbold symbolserver update 1 --url="http://new.symbol.server.url"
```

#### disable
Disable symbol server. Symbold won't use disabled symbol server. 
```
Usage: morgue symbold symbolserver disable [symbolserverid] 
```
Disable symbol server. Symbold won't use disabled symbol server.

#### enable 
Enable symbol server. Symbold won't use disabled symbol server. 
```
Usage: morgue symbold symbolserver enable [symbolserverid]
```
Enable symbol server.

#### whitelist/blacklist/skiplist

##### add 
Add new element to whitelist/blacklist
```
Usage: morgue symbold [whitelist|blacklist] [--name=...]
```
Add new element to blacklist/whitelist


##### remove 
Remove element from skiplist/blacklist/skiplist by using element id
```
Usage : morgue symbold [whitelist|blacklist|skiplist] [--itemid=...]
```

##### list 
List <--take> elements from [whitelist|blacklist|skiplist] from <--page> page
```
Usage: morgue symbold [whitelist|blacklist|skiplist] <--page=...> <--take=...>
```


#### skiplist [only]

##### find 
Find elements in skiplist
```
morgue symbold skiplist find [symbolServerId] [filter] <--page=...> <--take=...>
```
Usage: 
```
$ morgue symbold skiplist find 5 sample.dll 
```


##### remove all 
Remove all elements in skiplist
```
morgue symbold skiplist remove all [symbolServerId]
```
Usage: 
```
$ morgue symbold skiplist remove all 5
```

##### remove by filter
Remove all elements in skiplist that match filter criteria  
```
morgue symbold skiplist remove all [symbolServerId]
```
Usage: 
```
$ morgue symbold skiplist remove all 5
```


#### queue
Symbold queue commands

##### list 
returns all events in symbold queue
```
Usage: morgue symbold queue list 
```

##### Add
Add event on the top of symbold queue 
```
morgue symbold queue <add | create> <universe/project> <missingSymbol> <objectId> 
```
Usage:
```
$ morgue symbold queue add universe/project "a.pdb,123" 123
```

##### Size
Returns queue size - how many reports symbold still have to reprocess

```
Usage: morgue symbold queue size
```


##### Symbold
List all missing symbols from symbold events

```
Usage: morgue symbold queue symbold
```

### report

Create and manage scheduled reports.

```
Usage: morgue report <list | create | delete | send> [--project=...] [--universe=...]
```

#### create

```
Usage: morgue report <project> create
  <--rcpt=...>
  <--title=...>
  [--filter=...]
  [--fingerprint=...]
  [--histogram=...]
  [--hour=...]
  [--day=...]
  --period=<week | day>
```

Example:
```
$ morgue report MyProject create --rcpt=null@backtrace.io
    --rcpt=list@backtrace.io --filter=environment,equal,prod
    --title="Production Crashes weekly" --period=week
```

#### delete

```
Usage: morgue report <project> delete <report integer identifier>
```

#### list

```
Usage: morgue report <project> list
```

#### merge and unmerge

```
Usage: morgue merge <project> list of fingerprints
Usage: morgue unmerge <project> list of fingerprints
```

Fingerprints can be merged and unmerged to a group via those commands. A
group on a fingerprint is currently represented as a sha256 with mostly
zeros in the beginning. Those special group fingerprints can be used in
further merge commands to enlargen the group even more.

Unmerging accepts real fingerprints and groups. It separates the
fingerprint from the group. After the operation the fingerprint is
independent again.

When listing crashes, fingerprint;original can be used to get the original
fingerprint from before the grouping process if wanted.

### repair

```
Usage: morgue repair <[universe/]project>
```

Repair a project's attribute database. For each corrupted pages of a project's
attribute database, reprocess the affected objects (if possible). Once
completed and successful, transition the database into normal mode.

### reprocess

```
Usage: morgue reprocess <[universe/]project> [<query>|<object> ...] [--first N] [--last N]

Options for reprocess:
  --first=N        Specify the first object ID (default: earliest known)
  --last=N         Specify the last object ID (default: most recent known)
```

Reprocess the project's objects.  This command can be used to re-execute
indexing, fingerprinting, and symbolification (where needed).

If a set of objects (or query) is specified, any values for `--first` and
`--last` are replaced to match the object list.  If no query, object list,
or range is provided, all objects in the project are reprocessed.

### retention

```
Usage: morgue retention <list|set|status|clear> <name> [options]

Options for set/clear:
  --type=T         Specify retention type (default: project)
                   valid: instance, universe, project

Options for status:
  --type=T         Specify retention type (default depends on user access)
                   valid: universe, project

Options for set:
  --dryrun         Show the command that will be issued, but don't send it.
  --rules=N        Specify number of rules to set, which may be referenced
                   by rule actions/criteria, zero-indexed.  If a rule is not
                   referenced, rule #0 (the first) will be assumed.
  --age=[R,]O,T[,TE]
                   Specifies the matching object age for rule R.
                   O is the match operation, which may be one of:
                     'at-least', 'range'
                   T is the time, and for range, TE is the end time.
  --max-age=[R,]N  Specify time limit for objects, N, in seconds, for rule R.
                   Same as --age=[R,]at-least,N.
  --compress[=R]   Specify that the rule compresses matching object data.
  --delete=[R,S]   Specify that rule R deletes subsets S (comma-separated).
                   By default, if no subset is specified, all are deleted.
                   Valid subsets:
                   - physical: Object's physical data.
                   - crdb: Object's attribute data.
  --physical-only[=R]
                   Same as --delete=[R,]physical.
                   Specifies that the policy only delete physical copies;
                   event data will be retained.
```

Configure the retention policy for a given namespace, which can cover the
coroner instance, or a specific universe or project.

#### Examples

Set project blackhole's policy to delete everything older than 1 hour:

```
$ morgue retention set blackhole --max-age=3600 --delete
success
$ morgue retention list
Project-level:
  blackhole: criteria[object-age at-least 1h] actions[delete-all]
$
```

Set universe foobar's policy to compress after 30 days, and delete only
physical copies after 90 days:

```
$ morgue retention set --type=universe foobar --rules=2 --max-age=0,30d --compress=0 --max-age=1,90d --physical-only=1
success
$ morgue retention list
Universe-level:
  backtrace:
    rule #0: criteria[object-age at-least 1M] actions[compress]
    rule #1: criteria[object-age at-least 3M] actions[delete-all(physical-only)]
$
```

Set instance policy to compress after 7 days:
```
$ morgue retention set --type=instance --max-age=7d --compress
success
$ morgue retention list
Instance-level: criteria[object-age at-least 1w] actions[compress]
$
```

### sampling

```
Usage: morgue sampling <status|reset|configure> [options]

Options for either status or reset:
  --fingerprint=group             Specify a fingerprint to apply to.
                                  Without this, applies to all.
  --project=[universe/]project    Specify a project to apply to.
                                  Without this, applies to all.

Options for status only:
  --max-groups=N                  Specify max number of groups to display
                                  per project.
```

Retrieve the object sampling status, or reset it.
Project is a required flag if fingerprint is specified.

#### Configuring Sampling (Coronerd 1.50+)

In Coronerd 1.50, it became possible to configure sampling on a per-project
basis as well as using `coronerd.conf`.  This is done with the
`morgue sampling configure` command. Configurations specified on projects
override the `coronerd.conf` settings.  For example:

```
morgue sampling configure --project myproject \
--attribute version \
--backoff 1,0 \
--backoff 5,5m \
--backoff 100,1h
```

For information on how the Coronerd sampling algorithm works, see
[the Backtrace sampling documentation](https://support.backtrace.io/hc/en-us/articles/360047271572-Storage-Sampling-).

The available options are as follows:

- `--project`, `--universe`: specify which project to affect. `--universe` is
  optional.
- `--disable`: Ignore all other options and explicitly disable sampling for
  the specified project. This will apply even if there is configuration in
  `coronerd.conf`.
- `--clear`: Ignore all other options and clear any sampling config specific
  to this project. Afterwords, the specified project will use the sampling
  config from `coronerd.conf`.
- `--attribute`: Specify the attribute(s) to sample by. This option can be
  specified multiple times to sample by more than one attribute. Order is
  respected.
- `--backoff count,interval`: Specify a backoff entry. This option must be
  specified at least once, multiple instances must be specified in
  increasing order of interval, and the first backoff must always have a `0`
  interval.  `interval` supports time units: `1d`, etc.
- `--buckets`: The maximum number of sampling buckets to allow. Optional,
  default 512.
- `--process-whitelisted true|false`: whether to sample objects with
  whitelisted symbols. Optional, default true.
- `--process-private true|false`: whether to sample objects with private
  symbols. Optional, default true.
- `--reset-interval interval`: The reset interval. Supports time units.
  Default 1 day.

### symbol

```
Usage: morgue symbol <[<universe>/]project> [summary | list | missing | archives] [-o <output file>]
```

Retrieve a list of uploaded symbols or symbol archives. By default, `morgue symbol`
will return a summary of uploaded archives, available symbols and missing symbols.
If `archives` is used, a list of uploaded, in-process and symbol processing errors
are outputted. If `list` is used, then a list of uploaded symbols is returned. If
`missing` is used, then the set of missing symbols for the project are included.

### scrubber

Create, modify and delete data scrubbers.

```
Usage: morgue scrubber <project> <list | create | modify | delete>
```

Use `--name` to identify the scrubber. Use `--regexp` to specify the pattern to
match and scrub. Use `--builtin` to specify a builtin scrubber, `ssn`, `ccn`,
`key` and `env` are currently supported for social security number, credit card
number, encryption key and environment variable. If `--builtin=all` in `create`
subcommand, all supported builtin scrubbers are created. `--regexp` and
`--builtin` are mutually exclusive. Use `--enable` to activate the scrubber, 0
disables the scrubber while other integer values enable it.

### setup

```
Usage: morgue setup <url>
```

If you are using an on-premise version of `coronerd`, use `morgue setup`
to configure the initial organization and user. For example, if the server is
`backtrace.mycompany.com`, then you would run `morgue setup http://backtrace.mycompany.com`.
We recommend resetting your password after you enable SSL (done by configuring
your certificates).

### nuke

```
Usage: morgue nuke --universe=<universe name> [--project=<project name>]
```

If you want to nuke an object and all of the dependencies of the object.
Do not use this operation without making a back-up of your data.

### token

```
Usage: morgue token [create | list | delete] [--project=...] [--universe=...]
```

#### create

```
Usage: morgue token create --project=<project> --capability=<capability>
```

Capability can be any of:
 * symbol:post - Enable symbol uploads with the specified API token.
 * error:post  - Enable error and dump submission with the specified API token.
 * query:post  - Enable queries to be issued using the specified token.
 * sync:post   - Allow for slower but more verbose submission.

Multiple capabilities can be specified by using `--capability` multiple times
or using a comma-separated list.

#### list

```
Usage: morgue token list [--universe=...] [--project=...]
```

List API tokens in the specified universe, for all projects or a specified
project.

#### delete

```
Usage: morgue token delete <sha256 or prefix>
```

Delete the specified token by substring or exact match.

### user

```
Usage: morgue user reset [--universe=...] [--user=...] [--password=...]
```

Modify users.

Currently, can only be used to reset user passwords.  Prompts for user and
password if either is not specified.

### tenant

Create isolated tenants for receiving error data and log in. Tenants provide
namespace isolation. Users in one tenant are unable to interact with any
objects outside of their tenant.

This is an enterprise feature and not enabled by default for self-serve
customers. The tenant commands require superuser access.

```
Usage: morgue tenant <list | create | delete>
  create <name>: Create a tenant with the specified name.
  delete <name>: Delete a tenant with the specified name.
           list: List all tenants on your instance.
```

#### Examples

1.0 Create a Tenant

After logging into an object store as a superuser, we are able to simply
create a tenant using the following command:

```
$ morgue tenant create testingxyz
Tenant successfully created at https://testingxyz.sp.backtrace.io
Wait a few minutes for propagation to complete.
```

Tenants are required to be contained with-in the same TLD. For example,
a tenant of name `X` is expected to be contained in `X.sp.backtrace.io`.

After creating a tenant, you will probably need to invite an initial
administrator user for the tenant. For that, please see `invite` sub-command
listed below. You must use the `--tenant` option to invite an administrator
to a particular tenant.

2.0 Delete a Tenant

After logging into an object store as a superuser, we are able to simply
create a tenant using the following command:

```
$ morgue tenant delete testingxyz
Tenant successfully deleted.
```

Please note this is a destructive command from a configuration perspective.
Unless you are maintaining backups, there is no way to restore your
configuration data.

3.0 List Tenants

You can list existing tenants using the `morgue tenant list` command
as below.

```
$ morgue tenant list
  ID Tenant               URL
   1 test                 https://test.sp.backtrace.io
   4 test1                https://test1.sp.backtrace.io
```

### similarity

Compute the similarity and list acceptably similar crash groups according
to their callstack attribute.

```
Usage: morgue similarity <[universe]/project> [filter expression]
    [--threshold=N]     The minimum length of the callstack for groups to
                        consider for similarity analysis.
    [--truncate=N]      Shorten the callstack before comparing.   
    [--intersection=N]  The minimum number of common symbols between
                        two groups.
    [--distance=N]      The maximum acceptable edit distance between
                        two groups.
    [--fingerprint=N]   A fingerprint to compute similarity to. If omitted,
                        a project summary will be computed instead. 
    [--json]            Return the JSON result of the similarity request.                
```

### invite

Invite new users into your system. Requires you to have logged in.

```
Usage: morgue invite <create | list | resend>
  create <username> <email>
    --role=<"guest" | "member" | "admin">
    --metadata=<metadata>
    --tenant=<tenant name>
    --method=<"password" | "saml" | "pam">
  delete <token>
  resend <token>
```

#### Examples

1.0 Invite a User

Below, we invite a new user into the tenant currently logged into (or
the first tenant, if multiple exist). The default settings for the user
are to use password authentication and have a `member` role.

```
$ morgue invite create <username> <user e-mail>
```

```
$ morgue invite sbahra user@backtrace.io
Invitation successfully created for user@backtrace.io
Sending e-mail...done
```

1.1 Invite a User as an Administrator

```
$ morgue invite create user user@gmail.com --role=admin
Invitation successfully created for user@backtrace.io
Sending e-mail...done
```

1.2 Invite a User into a Particular Tenant

```
$ morgue invite create user user@gmail.com --tenant=mystudio
Invitation successfully created for user@backtrace.io
Sending e-mail...done
```

2.0 List Pending Invitation

This will list invitations that have yet to be accepted or
activated.

```
$ morgue invite list
Tenant             Username   Method     Role                          Email Token
     1              ashley2 password    admin         ashley2@backtrace.io f892200fa564...
     1                jack1 password   member            jack@backtrace.io 39c1b80a7e00...
     1                jack2 password   member          jack+2@backtrace.io c399bdf23873...
     1            jack17131 password   member       jack+4512@backtrace.io 784d2a8ffe12...
     1            jack25262 password   member      jack+24688@backtrace.io 97e306d3373a...
     1            jack25629 password   member      jack+28155@backtrace.io ed02ceea2ba4...
     1            jack28000 password   member       jack+3644@backtrace.io 3f87906bd5d9...
     1            jack19468 password   member      jack+28771@backtrace.io 3c6b3a3aaf41...
     1            jack15686 password   member       jack+4203@backtrace.io 78bd9cd127a8...
     4             jack2268 password   member      jack+19325@backtrace.io 776c6d389f89...
     4            jack20597 password   member      jack+24692@backtrace.io 48972737a85e...
     4             jack4803 password   member      jack+30407@backtrace.io 4943913c86f3...
```

3.0 Delete an Invitation

Below, we demonstrate how to delete an invitation. We pass a token (or unique
substring) for deletion.

```
$ morgue invite delete f8922
Invitation successfully deleted.
```

### callstack evaluate

Use this command to check the callstack results for a given object.

### Example (using object id)

```
$ morgue callstack evaluate project oid
```

### Example (using local file, must be JSON)

```
$ morgue callstack evaluate project file.json
```

## Access control

Allows controlling coroner's access control mechanisms
```
Usage:
morgue access <action> [params...]

actions:
 - team
 - project

action team:
    morgue access team <create|remove|details> <team>
    morgue access team add-user <user>
    morgue access team remove-user <user>
    morgue access team list

action project:
    morgue access project <project> add-team <team> <role>
    morgue access project <project> remove-team <team>
    morgue access project <project> add-user <user> <role>
    morgue access project <project> remove-user <user>
    morgue access project <project> details
```

### action team
Allows manipulation of teams - creation, removal, listing, displaying details and adding/removing users to teams.

### action project
Allows manipulation of projects in terms of access control - display details or add/remove user or team.

Possible roles:
- admin
- member
- guest

If a user has access through multiple sources (e.g. they belong to
two teams and also have direct project membership) they will have
the highest privileges afforded by any of those access routes.

## Metrics Importing Functionality

It is possible to use Morgue to configure importers for stability score.  THis
requires Coronerd >= 1.48 and a deployed backtrace-metrics-importer.
Usage:

```
morgue metrics-importer <command>...
```

### `source check-query`

Determines if a query is valid by running it against a source as if it had been
used with an importer and displays diagnostic information.  For example:

```
morgue metrics-importer source check-query --source my-source-uuid \
--query 'select time, value from test where time >= $1 and time < $2'
```

### `importer create`

Creates an importer.  Takes the following options:

Option         | Description
-------------- | --------------------------------------------------------------
--source       | UUUID of the source to associate the importer with.
--name         | The name of the importer to create.
--start-at     |  The time to start scraping from in RFC3339 format.
--metric       | The name of the metric to associate data with in Coronerd.
--metric-group | The name of the metric group to associate data with in Coronerd.
--delay        | The delay of the importer. Defaults to 60.

For example:

```
morgue metrics-importer importer create \
--source my-source-id \
--name my-importer \
--start-at 2020-08-05T00:00:00Z \
--metric my-metric \
--metric-group my-group \
--quiery 'select time, value from test where time >= $ and time < $2' \
--delay 120
```

Note that `--query` depends on the source type.  See the stability score
documentation for details.

### `logs`

Displays logs.  Usage:

```
morgue metrics-importer logs --source-id my-source-id
morgue metrics-importer logs --importer-id my-importer-id
```

You can pass `--limit` to limit the number of returned messages.
By default `--limit` is 100.
