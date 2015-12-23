var express = require('express');
var app = express();
var request = require('request');
var fs = require('fs');
var urlParser = require('url')

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
 * Read in Alex Rankings text file to a local array.
 * 
 * Source: https://support.alexa.com/hc/en-us/articles/200461990-Can-I-get-a-list-of-top-sites-from-an-API-
 */
var alexaRankings = [];
fs.readFile('topAlexaSites.txt', function (err, data) {
   if (err) {
       return console.error(err);
   }
   alexaRankings = data.toString().split(',');
});

});

/**
 * Read in Ignored Domains text file to a local array.
 */
var ignoredDomains = [];
fs.readFile('ignoredDomains.txt', function (err, data) {
   if (err) {
       return console.error(err);
   }
   ignoredDomains = data.toString().split(',');
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
 * On a regular interval, updates archive links with latest /r/all posts
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

/**
 * Returns a filtered and processed list of urls
 */
function processRedditUrls(links) {
  console.log('processing link count on ' + new Date() + ': ' + links.length);
  var filteredLinks = [];
  links.forEach(function(link) {
    // Get domain and protocoless url
    var domain = getDomain(link);
    var newLink = link.replace(/.*?:\/\//g, "");
    
    // Filter out ignored domains
    if (ignoredDomains.indexOf(domain) >= 0) {
      newLink = null;
    } else if (alexaRankings.indexOf(domain) >= 0) {
      newLink = null;
    } else {
      filteredLinks.push(newLink);
    }
  });
  
  console.log('processed link count on ' + new Date() + ': ' + filteredLinks.length);
  console.log(filteredLinks);
  return filteredLinks;
}

/**
 * Gets host and domain.
 * 
 * Note: there is a bug where this does not work for .co.uk or other types of subdomains.
 * 
 * Source: http://www.primaryobjects.com/2012/11/19/parsing-hostname-and-domain-from-a-url-with-javascript/
 */
function getHostName(url) {
    var match = url.match(/:\/\/(www[0-9]?\.)?(.[^/:]+)/i);
    if (match != null && match.length > 2 && typeof match[2] === 'string' && match[2].length > 0) {
    return match[2];
    }
    else {
        return null;
    }
}
function getDomain(url) {
    var hostName = getHostName(url);
    var domain = hostName;
    
    if (hostName != null) {
        var parts = hostName.split('.').reverse();
        
        if (parts != null && parts.length > 1) {
            domain = parts[1] + '.' + parts[0];
                
            if (hostName.toLowerCase().indexOf('.co.uk') != -1 && parts.length > 2) {
              domain = parts[2] + '.' + domain;
            }
        }
    }
    return domain;
}

function retrievedPage(json, count) {
  // Append each url on the page to redditUrls
  json['data']['children'].forEach(function(child) {
    // Remove protocol prior to pushing
    redditUrls.push(child['data']['url']);
  });
  
  // Continue getting the first 1000 urls then process them
  if (count < 1000) {
    getRedditPage(count+100, json['data']['after'], 0);
  } else {
    processRedditUrls(redditUrls);
  }
}