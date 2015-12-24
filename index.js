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
 * 
 * Note: The provided link must have its protocol removed (since
 * there is no reason to distinguish between http and https).
 */
app.get('/redditmirror/v1/mirror', function(request, response) {
  var redditUrl = request.query["url"];
  client.get(redditUrl, function(err, reply) {
    if (!err && reply != null) {
      // Return a 200 sucess response with the url
      response.send({url: reply});
    } else {
      // Return a response "Not Found"
      response.status(404);
      response.send();
    }
  });
});

/**
 * POST Archive Link for debugging purposes.
 */
/*app.post('/redditmirror/v1/mirror', function(request, response) {
  var redditUrl = request.query["url"];
  var archiveUrl = request.query["archiveUrl"];
  client.set(redditUrl, archiveUrl, function(err, reply) {
    if (!err && reply != null) {
      console.log('saved for: ' + redditUrl + ', ' + archiveUrl);
      response.send({url: reply});
    } else {
      console.log('not exist for: ' + redditUrl + ', ' + archiveUrl);
      response.send({url: null});
    }
  });
});*/

/**
 * On a regular interval, updates archive links with latest /r/all posts
 */
var redditUrls = [];
var currentPage = {count: 0, after: ''};
var archivedLinksCount = 0;
function archiveReddit() {
  console.log('retrieving /r/all pages at: ' + new Date());
  archivedLinksCount = 0;
  getRedditPage(0, "", 0);
    
  // Call this function again in 15 minutes
  setTimeout(archiveReddit, 15*60000);
}
archiveReddit();

function getRedditPage(count, after, retries) {
  var url = 'https://www.reddit.com/r/all/.json?count=' + count + '&after=' + after;
  request(url, function (error, response, body) {
    //Check for error
    if(error){
      if (error.code == 'ECONNRESET') {
        // No response from server, try again
        if (retries < 5) {
          setTimeout(function() {
            getRedditPage(count, after, retries+1);
          }, 5000);
        }
      }
        
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
var filePattern = new RegExp(".(gif|jpg|jpeg|png|bmp|gifv|mp3|mp4|avi|doc|swf|xls|ppt|pdf)$"); // Todo: Handle gifv and other html5 images
filePattern.ignoreCase = true;
function processRedditUrls(links) {
  console.log('processing link count on ' + new Date() + ': ' + links.length);
  var filteredLinks = [];
  links.forEach(function(link) {
    var parsedUrl = urlParser.parse(link);
    var domain = getDomain(parsedUrl.hostname);
    var newLink = link.replace(/.*?:\/\//g, "");
    
    if (filePattern.test(parsedUrl.pathname.toLowerCase())) {
      // Filter out files
       newLink = null;
    } else if (ignoredDomains.indexOf(domain) >= 0) {
      // Filter out ignored domains
      newLink = null;
    } else if (alexaRankings.indexOf(domain) >= 0) {
      newLink = null;
    } else {
      filteredLinks.push(newLink);
    }
  });
  
  console.log('processed link count on ' + new Date() + ': ' + filteredLinks.length);
  archiveLinks(filteredLinks);
}

/**
 * Gets host and domain.
 * 
 * Note: there is a bug where this does not work for .co.uk or other types of subdomains.
 * 
 * Source: http://www.primaryobjects.com/2012/11/19/parsing-hostname-and-domain-from-a-url-with-javascript/
 */
function getDomain(hostName) {
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
  if (count < 5000) {
    getRedditPage(count+100, json['data']['after'], 0);
  } else {
    processRedditUrls(redditUrls);
  }
}

/**
 * From the provided links, achives the first 5 that are not already archived.
 */ 
function archiveLinks(links) {
  links.forEach(function(link) {
    archiveLink(link);
  });
}

/**
 * Attempt to archive link.
 */
function archiveLink(link) {
  client.get(link, function(err, reply) {
    if (!err && reply != null) {
    } else {
      addToArchive(link);
    }
  });
}

/**
 * Submit a POST for a link to archive and then add it to the redis archive.
 */
function addToArchive(link) {
  if (archivedLinksCount >= 20) return;
  ++archivedLinksCount;
  
  var options = {
    url: 'https://archive.is/submit/',
    form: {url:link},
    headers: {
      Accept:'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language':'en-US,en;q=0.8,zh-CN;q=0.6',
      'Cache-Control':'no-cache',
      'Content-Type':'application/x-www-form-urlencoded',
      Pragma:'no-cache',
      'Upgrade-Insecure-Requests':1,
      'User-Agent':'Mozilla/5.0 (Windows NT 6.3; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/47.0.2526.80 Safari/537.36'
    }
  }
  request.post(options, function(err,httpResponse,body){
    if (!err) {
      var header = JSON.parse(JSON.stringify(httpResponse.headers));
      var refresh = header['refresh'];
      var locationUrl = header['location'];
      if (refresh != null) {
        var archiveLink = refresh.split('=')[1];
        addToLocalArchive(link, archiveLink);
      } else if (locationUrl != null) {
        addToLocalArchive(link, locationUrl);
      } else {
      }
    } else {
    }
  });
}

function addToLocalArchive(link, archiveLink) {
  client.set(link, archiveLink, function(err, reply) {
    if (!err) {
      console.log('saved for: ' + link + ', ' + archiveLink);
    } else {
    }
  });
}