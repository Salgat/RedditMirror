var express = require('express');
var app = express();
var request = require('request');

var client;
if (process.env.REDIS_URL) {
  client = require('redis').createClient(process.env.REDIS_URL);
} else {
  client = require('redis').createClient();
}

app.set('port', (process.env.PORT || 5000));

app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});

client.on('connect', function() {
    console.log('connected to redis');
});

/**
 * GET Archive Link.
 */
app.get('/redditmirror/v1/mirror', function(request, response) {
  var redditUrl = request.query["url"];
  client.get(redditUrl, function(err, reply) {
    if (!err) {
      console.log('url exists for: ' + redditUrl);
      response.send({url: reply});
    } else {
      console.log('url does not exist for: ' + redditUrl);
      response.send({url: null});
    }
  });
});

/**
 * POST Archive Link for debugging purposes.
 */
app.post('/redditmirror/v1/mirror', function(request, response) {
  var redditUrl = request.query["url"];
  var archiveUrl = request.query["archiveUrl"];
  client.set(redditUrl, archiveUrl, function(err, reply) {
    if (!err) {
      console.log('saved for: ' + redditUrl + ', ' + archiveUrl);
      response.send({url: reply});
    } else {
      console.log('not exist for: ' + redditUrl + ', ' + archiveUrl);
      response.send({url: null});
    }
  });
});

/**
 * On a regular interview, updates archive links with latest /r/all posts
 */
var redditUrls = [];
var currentPage = {count: 0, after: ''};
function archiveReddit() {
  console.log('retrieving /r/all pages at: ' + new Date());
  getRedditPage(0, "", 0);
    
  // Call this function again in 10 minutes
  setTimeout(archiveReddit, 600000);
}
archiveReddit();

function getRedditPage(count, after, retries) {
  var url = 'https://www.reddit.com/r/all/.json?count=' + count + '&after=' + after;
  request(url, function (error, response, body) {
    //Check for error
    if(error){
        return console.log('Error:', error);
    }

    //Check for right status code
    if(response.statusCode !== 200){
        // If failed, wait and retry again
        if (retries < 5) {
          setTimeout(function() {
            getRedditPage(count, after, retries+1);
          }, 5000);
        }
        return console.log('Invalid Status Code Returned:', response.statusCode + ' for count: ' + count);
    }

    var json = JSON.parse(body);
    retrievedPage(json, count);
  });
}

function processRedditUrls() {
  console.log('processing reddit urls for ' + new Date() + ': ' + redditUrls);
}

function retrievedPage(json, count) {
  // Append each url on the page to redditUrls
  json['data']['children'].forEach(function(child) {
    // Remove protocol prior to pushing
    //console.log('pushing url: ' + child['data']['url'].replace(/.*?:\/\//g, ""));
    redditUrls.push(child['data']['url'].replace(/.*?:\/\//g, ""));
  });
  
  // Continue getting the first 1000 urls then process them
  if (count < 1000) {
    getRedditPage(count+100, json['data']['after'], 0);
  } else {
    processRedditUrls();
  }
}