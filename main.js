var baseUrl = "https://bridge.competitionsuite.com/api/orgscores/";
var request = require('request');
var mysql   = require('mysql');

if (!String.format) {
  String.format = function(format) {
    var args = Array.prototype.slice.call(arguments, 1);
    return format.replace(/{(\d+)}/g, function(match, number) {
      return typeof args[number] != 'undefined'
        ? args[number]
        : match
      ;
    });
  };
}

var dbConnection = mysql.createConnection({
  host     : 'localhost',
  user     : 'root',
  password : '',
  database : 'corpstime'
});

var corpsMap = {};
dbConnection.connect();
dbConnection.query('select * from corps', function(err, results, fields) {
  if(err) {
    console.log(err);
  }
  else {
    for (var i = 0; i < results.length; i++) {
      var corps = results[i];
      corpsMap[corps['name']] = corps['id'];
    }
  }
})

function getSeasons() {
  request(baseUrl + 'GetSeasons/jsonp?organization=96b77ec2-333e-41e9-8d7d-806a8cbe116b&version=1.1.5&callback=json',
    function (error, res, body) {
      if(error) {
        console.log(error);
      }
      else {
        body = stripJsonText(body);
        return JSON.parse(body);
    }
  });
}

function getCurrentCompetitions(fromDate) {
  request(baseUrl + 'GetCompetitionsByOrganization/jsonp?organization=96b77ec2-333e-41e9-8d7d-806a8cbe116b&showTrainingEvents=false&version=1.1.5&callback=json',
    function(err, res, body) {
      if(err) {
        console.log(err);
      }
      else {
        body = stripJsonText(body);
        var competitionsJson = JSON.parse(body)['competitions'];
        if(fromDate) {
          competitionsJson = competitionsJson.filter(c => {
            return (new Date(c['competitionDate']).getTime() - fromDate.getTime() >= 0);
          });
        }
        getCompetitionScores(competitionsJson)
      }
  });
}

function stripJsonText(text) {
  return text.substr(5, text.length - 7);
}

function getCompetitionScores(competitionsJson) {
  for (var i = 0; i < competitionsJson.length; i++) {
    var competition = competitionsJson[i];
    //console.log(competition);
    var guid = competition['competitionGuid']
    getScoreForCompetition(guid);
  }
}

function getScoreForCompetition(guid) {
  request(String.format(baseUrl + '/GetCompetition/jsonp?competition={0}&version=1.1.5&callback=json', guid),
    function(err, res, body) {
      if(err) {
        console.log(err);
      }
      else {
        var output = JSON.parse(stripJsonText(body));
        output['name'] = cleanPresentedBy(output['name']);
        saveScoredCompetition(output);
      }
    });
}

function cleanPresentedBy(text) {
  return text.split("presented")[0].trim();
}

function saveScoredCompetition(competitionJson) {
  var competitionName = competitionJson['name'];
  var compLocation = competitionJson['location'];
  compLocation = compLocation.replace(".", ",");
  dbConnection.query('Select id from competition where name = ? and location = ?', [competitionName, compLocation],
    function(err, results, fields) {
      if(err) {
        console.log(err);
      }
      else {
        if(results[0]) {
          var compId = results[0]['id']
          saveCorpsForCompetition(compId, competitionJson);
        }
        else {
          console.log("Couldn't find: ", competitionName, compLocation);
        }
      }
    });
}

function saveCorpsForCompetition(compId, competitionJson) {
  for(var round = 0; round < competitionJson['rounds'].length; round++) {
    var performances = competitionJson['rounds'][round]['performances'];
    for(var i = 0; i < performances.length; i++) {
      var scoredCorps = performances[i];
      var corpsId = corpsMap[scoredCorps['name']];
      if(corpsId) {
        updateCompetitionRecord(scoredCorps, corpsId, compId);
      }
    }
  }
}

function updateCompetitionRecord(scoredCorps, corpsId, compId) {
  dbConnection.query('select id from competitioncorps where competitionid = ? and corpsid = ?', [compId, corpsId],
    function(err, results, fields) {
      if(err) {
          console.log(err);
      }
      else {
        if(results[0]) {
          var compCorpsId = results[0]['id'];
          dbConnection.query('update competitioncorps set placement = ?, score = ? where id = ?', [scoredCorps['rank'], scoredCorps['score'], compCorpsId],
            function(err, results, fields) {
              if(err) {
                console.log('Error updating competioncorps table', err);
              }
          });
        }
      }
    });
}

getCurrentCompetitions(new Date(Date.now() - (1000*60*60*24)*2));
