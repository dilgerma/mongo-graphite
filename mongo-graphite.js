var MongoClient = require('mongodb').MongoClient,
    ReadPreference = require('mongodb').ReadPreference,
    _ = require('underscore'),
    ReplSetServers = require('mongodb').ReplSetServers,
    GraphiteClient = require('./lib/GraphiteClient'),
    config = require('./config.json');

var args = process.argv.slice(2);

process.argv.forEach(function (val, index, array) {
    console.log(index + ': ' + val);
});
var gather_interval = 60;
if (config.runIntervalSeconds) {
    if (gather_interval > 0) {
        gather_interval = config.runIntervalSeconds * 1000;
    }
}

var debugMode = config.debugMode || false;

var graphiteConfig = {'port': config.graphite.port, 'host': config.graphite.host, 'debugMode': debugMode};
console.log("Creating Graphite Client for " + JSON.stringify(graphiteConfig));
var gc = new GraphiteClient(graphiteConfig);


notifyGraphite = function () {

    console.log("Notification startet for " + JSON.stringify(config));
    //loop through the "commands" we plan to run
    for (var i = config.commands.length - 1; i >= 0; i--) {

        var command = config.commands[i];
        var target = command.targetDb;

        (function (currentCommand, targetDb) {

            console.log("initializing - collecting data from mongo instance : " + targetDb);
            //now loop through the dbs, and match them with the command.
            for (var z = config.dbs.length - 1; z >= 0; z--) {
                if (config.dbs[z].name.toLowerCase() === targetDb.toLowerCase()) {
                    var currentDb = config.dbs[z];
                    var servers = currentDb.servers;
                    var dbName = currentDb.name;
                    var user = currentDb.user;
                    var password = currentDb.pass;
                    console.log("loading from mongo / sending to graphite initiated");
                    pullAndSend(servers, dbName, user, password, currentCommand);

                } else {
                    console.error('No matching database defined for command target db:' + targetDb + ". Please check your config if you have a typo in the database name.");
                }
            }
        })(command, target);
    }
    console.log("Waiting..");
};

console.log("Setting graphite notification interval to " + (gather_interval / 1000) + " seconds");
setInterval(notifyGraphite, gather_interval);
console.log("Waiting..");

var mongoConnectionString = function (host, port, user, pass, db) {
    console.log("user: " + user + ", " + "pass " + pass);
    var userPassword = (user ? user : "") + (pass ? (":" + pass) : "");
    return "mongodb://" + (userPassword ? userPassword + "@" : "") + host + ":" + port + (db ? ("/" + db) : "");
};

var pullAndSend = function (servers, dbName, user, password, currentCommand) {
    console.log("Notifying mongo instances " + JSON.stringify(servers));
    var serverArray = [];

    if (!_.isArray(servers)) {
        servers = [servers];
    }

    for (var y = 0; y < servers.length; y++) {

        var host = servers[y].host;
        var port = servers[y].port;

        var url = mongoConnectionString(host, port, user, password, dbName);
        console.log("connecting to " + url);
        MongoClient.connect(url, function (err, db) {

            if (err) {
                console.error("Database connection failed : " + err);
            } else {
                console.log("Database connetion established");

                db.command(currentCommand.commandObject, function (err, result) {
                    //console.log('command callback', err, result);

                    var parser = new JsonParser();
                    var metricsToCapture = currentCommand.valueToGraphite;
                    for (var a = metricsToCapture.length - 1; a >= 0; a--) {

                        var value = parser.parse(metricsToCapture[a].location, result);

                        host = host.replace(/\./g, '_');

                        var metricName = 'mongodb.' + host + '.' + db.databaseName + '.' + metricsToCapture[a].location;
                        if (value || value === 0) {
                            var tempObj = {};
                            tempObj[metricName] = value;
                            console.log('sending metric to graphite:', tempObj);
                            gc.write(tempObj);
                        } else {
                            console.log('no value for metric:', metricName, value);
                        }

                    }
                    db.close();
                })

            }
        });
    }
};


//serverStatus
//stats
//replSetGetStatus
//serverInfo

var JsonParser = function (dotNotation) {
    //this.billSize = billSize;
    this.selectorFormat = dotNotation;
    this.next = null;
};
JsonParser.prototype = {
    parse: function (dotNotation, serverStatus) {
        var value = this._getValueByDotNotation(dotNotation, serverStatus);
        serverStatus && this.next && this.next.parse(serverStatus);
        return value;
    },
    // set the stack that comes next in the chain
    setNextParser: function (stack) {
        this.next = stack;
    },
    _index: function (obj, i) {
        if (obj) {
            return obj[i]
        } else {
            return null;
        }
    },
    _getValueByDotNotation: function (location, obj) {
        return location.split('.').reduce(this._index, obj);
    }

};






