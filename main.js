var baseUrl = "https://backend.dci.org/api/v1/"
var request = require('request');
var mysql = require('mysql');

if (!String.format) {
    String.format = function (format) {
        var args = Array.prototype.slice.call(arguments, 1);
        return format.replace(/{(\d+)}/g, function (match, number) {
            return typeof args[number] != 'undefined' ? args[number] : match;
        });
    };
}

var dbConnection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'corpstime'
});

const corpsMap = {};
dbConnection.connect();
dbConnection.query('select * from corps', function (err, results, fields) {
    if (err) {
        console.log(err);
    }
    else {
        for (var i = 0; i < results.length; i++) {
            var corps = results[i];
            corpsMap[corps['name']] = corps['id'];
        }
    }
})

function getEvents() {
    console.log('Getting events');
    request(baseUrl + 'events?sort=startDate&limit=200', function (err, res, body) {
        if (err) {
            console.log(err)
        }
        else {
            saveNewEvents(JSON.parse(body));
        }
    });
}

function saveNewEvents(events) {
    for (let i = 0; i < events.length; i++) {
        let event = events[i];
        //console.log(event.name + ' - ' + event.locationCity + ', ' + event.locationState);
        findAndSaveEvent(event);
    }
}

function findAndSaveEvent(event) {
    dbConnection.query('select id from venue where dciid = ?', event.venue.id, (err, results, fields) => {
        if (err) {
            console.log(err);
        } else if (results.length === 1) {
            saveEvent(event, results[0].id);
        } else {
            console.log('Inserting venue for ' + event.name + ' venue: ' + event.venue.name);
            saveVenueAndEvent(event);
        }
    });
}

function saveEvent(event, venueId) {
    console.log('Saving event: ' + event.name + ' venueId: ' + venueId);
    let eventStartTime = event.startTime ? event.startTime.slice(0, event.startTime.indexOf("+")) : null;
    dbConnection.query('insert into competition (name, location, date, imageurl, venueid) values(?, ?, ?, ?, ?)',
        [event.name, event.locationCity + ', ' + event.locationState, eventStartTime, event.eventImage, venueId],
        (err, results, fields) => {
            if (err) {
                console.log(err);
            } else {
                saveCorpsForCompetition(results.insertId, event.schedules)
            }
        })
}

function saveVenueAndEvent(event) {
    let venue = event.venue;
    console.log('Saving venue ' + venue.name);
    dbConnection.query('insert into venue (dciid, name, address, surfacetype) values (?, ?, ?, ?)',
        [venue.id, venue.name, venue.address + ' ' + venue.city + ', ' + venue.state, venue.surfaceType],
        (err, results, fields) => {
            if (err) {
                console.log(err);
            } else {
                saveEvent(event, results.insertId);
            }
        });
}

function getSeasons() {
    request(baseUrl + 'GetSeasons/jsonp?organization=96b77ec2-333e-41e9-8d7d-806a8cbe116b&version=1.1.5&callback=json',
        function (error, res, body) {
            if (error) {
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
        function (err, res, body) {
            if (err) {
                console.log(err);
            }
            else {
                body = stripJsonText(body);
                var competitionsJson = JSON.parse(body)['competitions'];
                if (fromDate) {
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
        function (err, res, body) {
            if (err) {
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
        function (err, results, fields) {
            if (err) {
                console.log(err);
            }
            else {
                if (results[0]) {
                    var compId = results[0]['id']
                    saveCorpsForCompetition(compId, competitionJson);
                }
                else {
                    console.log("Couldn't find: ", competitionName, compLocation);
                }
            }
        });
}

function saveCorpsForCompetition(competitionId, corpsJson) {
    let insert = function (compId, corpsId, position, time) {
        time = time ? time : 'TBD'
        dbConnection.query('insert into competitioncorps (competitionid, corpsid, placement, score, time) values (?, ?, ?, ?, ?)',
            [compId, corpsId, position, 0, time], (err, results, fields) => {
                if (err) {
                    console.log(err);
                }
            }
        );
    }

    for (let pos = 0; pos < corpsJson.length; pos++) {
        let corps = corpsJson[pos];
        let corpsId = corpsMap[corps.unitName];
        if (corpsId) {
            insert(competitionId, corpsId, pos, corps.time)
        } else {
            console.log('Unable to find corps: ' + corps.unitName);
        }

    }
}

function updateCompetitionRecord(scoredCorps, corpsId, compId) {
    dbConnection.query('select id from competitioncorps where competitionid = ? and corpsid = ?', [compId, corpsId],
        function (err, results, fields) {
            if (err) {
                console.log(err);
            }
            else {
                if (results[0]) {
                    var compCorpsId = results[0]['id'];
                    dbConnection.query('update competitioncorps set placement = ?, score = ? where id = ?', [scoredCorps['rank'], scoredCorps['score'], compCorpsId],
                        function (err, results, fields) {
                            if (err) {
                                console.log('Error updating competioncorps table', err);
                            }
                        });
                }
            }
        });
}

//getCurrentCompetitions(new Date(Date.now() - (1000*60*60*24)*2));
getEvents();
