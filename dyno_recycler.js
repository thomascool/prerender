
var logs = require('https')
  , admin = require('https')
  , _ = require('underscore')
  , url  = require('url')
  , request = require('request');

var APP_ID = process.env.RECYCLER_APP_ID
  , LOGENTRIES_KEY = process.env.RECYCLER_KEY
  , HEROKU_TOKEN = process.env.RECYCLER_TOKEN
  , appDynoRestarted = false;


var alertHipChat = function(msg) {
  request.post('https://api.hipchat.com/v1/rooms/message?auth_token=73c44ad21d8ef7febda81e33adcda0&room_id=116219&from=Recycler&message=@thomas%20'+escape(msg) );
}

var restart_prerender = _.once(function(){
  var headers = {
      'Accept': 'application/vnd.heroku+json; version=3',
      'Authorization': 'Bearer ' + HEROKU_TOKEN
    }
    , serverOptions = {
      host:'api.heroku.com',
      port:443,
      path:'/apps/rbss-prerender/dynos',
      method: 'DELETE',
      headers: headers
    }
    , request = admin.request(serverOptions);

  request.on('response', function (response) {
    var response_body = '';
    response.setEncoding('utf-8');
    response.on('data', function (chunk) {
      response_body += chunk;
    });
    response.on('end', function () {
      alertHipChat('App [rbss-prerender] restart completed for new production release.');
    });
  });
  request.on('error', function(e) {
    console.error('Error: %s',e);
    alertHipChat('Error: '+e+' on dyno_recycler:[rbss-prerender]');
    process.exit(5);
  });
  request.end();
});

var recycler=function(timeoutAllowed, keyWords, ignore) {
  var STARTTIME = (new Date().getTime()) - 600000 ; // CURRENT TIMESTAMP - 10mins

  var endResult = {}
    , paramList = ['npm%20run-script%20textsearch-job',
      'H12',
      'Error%20R14',
      'Error:%20getaddrinfo%20EADDRINFO'];

  if (paramList.indexOf(keyWords) == -1) {
    // only predefined keywords for the filter
    console.log('ERROR: Invalid filter value!');
    alertHipChat('Error: Invalid filter value on '+APP_ID+' for ['+keyWords+']');
    process.exit(1);
  }

  var options = {
    hostname: 'pull.logentries.com',
    port: 443,
    path: '/'+ LOGENTRIES_KEY +'/hosts/Heroku/'+ APP_ID +'/?start='+ STARTTIME +'&filter='+keyWords,
    method: 'GET'
  };

  var req = logs.request(options, function(res) {

    res.on('data', function(d) {
      if (keyWords === 'H12') {
        // Parsing the logs for H12 (request timeout)
        _.each(
          _.filter( d.toString().split(' '), function(item) {
            var found = (item.substring(0, 5) == 'dyno=') && (d.toString().indexOf(ignore) == -1)
            return found;
          }), function(result) {
            if (endResult[result.substring(5)]) {
              endResult[result.substring(5)] = endResult[result.substring(5)] + 1;
            } else {
              endResult[result.substring(5)] = 1;
            }
          }
        )
      }
      if (keyWords === 'Error%20R14') {
        // Parsing the logs for Error R14 (Memory quota exceeded)
        _.each(
          _.filter( d.toString().split(' '), function(item) {
            return (item.substring(0, 4) == 'web.');
          }), function(result) {
            if (endResult[result]) {
              endResult[result] = endResult[result] + 1;
            } else {
              endResult[result] = 1;
            }
          }
        )
      }
      if (keyWords === 'npm%20run-script%20textsearch-job') {
        // Parsing the logs to trigger the application has been deployed
        _.each(
          _.filter( d.toString().split(' '), function(item) {
            return item == 'Starting';
          }), function(result) {
            appDynoRestarted = true;
            restart_prerender();
          }
        )
      }
    });

    res.on('close', function(){
      _.each( endResult, function(v, k) {
        // Only restart the dyno when it has multiple time-out occurred in last 30 minutes
        if ((v >= timeoutAllowed) && (appDynoRestarted == false)) {
          console.log('Dyno %s going to be restarted.', k);
          var DYNO_ID = k;

          var headers = {
              'Accept': 'application/vnd.heroku+json; version=3',
              'Authorization': 'Bearer ' + HEROKU_TOKEN
            }
            , serverOptions = {
              host:'api.heroku.com',
              port:443,
              path:'/apps/'+ APP_ID +'/dynos/'+DYNO_ID,
              method: 'DELETE',
              headers: headers
            }
            , request = admin.request(serverOptions);

          request.on('response', function (response) {
            var response_body = '';
            response.setEncoding('utf-8');
            response.on('data', function (chunk) {
              response_body += chunk;
            });
            response.on('end', function () {
              console.log('Dyno %s restart completed with value [%s].', DYNO_ID, response_body);
              alertHipChat('Dyno '+DYNO_ID+' restart completed on '+APP_ID+' for ['+keyWords+']');
            });
          });
          request.on('error', function(e) {
            console.error('Error: %s',e);
            alertHipChat('Error: '+e+' on '+APP_ID+' for ['+keyWords+']');
            process.exit(3);
          });
          request.end();
        }
      });
    });

  });

  req.end();

  req.on('error', function(e) {
    console.error(e);
    alertHipChat('Error: '+e+' on '+APP_ID+' for ['+keyWords+']');
    process.exit(2);
  });

};

recycler(2, 'Error%20R14');  // Error R14 (Memory quota exceeded)
