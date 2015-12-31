# RedditMirrorAPI
A mirror API for Reddit's top submissions

## Example
A live example is available at http://redditmirror.salgat.net.

To test, use your favorite REST client (I use the Chrome App "Advanced Rest Client") and do the following GET request,
* GET http://redditmirror.salgat.net/redditmirror/v1/mirror?url=www.digitalnewsarena.com/2015/12/a-working-light-based-processor.html

You should see the response,

  ``{"url":"https://archive.is/1mMCi"}``

## Installation And Running

### Requirements
Install both of these prior to running this project.
* [npm (package manager)](https://www.npmjs.com)
* [redis (database)](http://redis.io/)

### Running
* Open the command line, change the directory to where this project is located, and enter command "npm start"

## Description
RedditMirrorAPI works by checking Reddit's /r/all for the 5000 most popular website submissions. After using GETs to retrieve the links from Reddit, the array of links is filtered three different ways. 

1. First, the link is checked to see if it is a media format, such as a jpg or gif or video extension. All media is blocked (since the mirror is not meant for media). 
2. Next, the link is compared against a small list of domains to ignore. These are either domains that only host media (such as imgur and youtube), or are domains that are assumed to never go down, like yahoo and google. Additionally, there are a few special cases such as reddit.com, for example, which is ignored to exclude self-posts.
3. Finally, the link is compared against a list of the top [Alexa Rank](https://www.alexa.com) domains. The assumption is that these sites with the most traffic are also likely to not go down, since they aren't susceptible to the "Reddit effect" where a huge surge in traffic brings down a small website.

After filtering down the links to a small set that are eligible for archiving, these links are checked against the redis database to check if they already have archives setup. If they don't, the first 20 non-archived links are POSTed to [archive.is](http://archive.is/) to be archived on their site. Each POST request returns a link to the archive, which is stored in the database to be recalled upon a GET request (GET http://localhost:5000/redditmirror/v1/mirror?url=myarchivedlink.com/) for that site's mirror. After 15 minutes, the whole process is repeated to archive the next 20 eligible submissions.
