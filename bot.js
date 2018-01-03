const Discord = require('discord.js');
const mongodb = require('mongodb');
const MongoClient = mongodb.MongoClient;
const XLSX = require('js-xlsx');
const request = require('request');
const customConfig = require('./config.json');
const checkCustomCommands = require('./checkCustomCommands.js');
// Initialize Discord Bot
const bot = new Discord.Client();
// override default config values with values from config.json
const defaultConfig = {
  token: null, // no default
  prefix: 'toru ',
  botName: 'ToruAdventure',
  unknownCommandString: `I don't understand that command`,
  dbNamePrefix: 'ToruAdventure',
  dbUrl: 'mongodb://localhost:27017', // defaults to local, override with cloud url if wanted
  botUserId: '-1', // get from bot user
};
const config = Object.assign({}, defaultConfig, customConfig);

// db client assumes mongodb >= 3.0
let myClient;

const getHelpMessage = (useDescription) => {
  const prefix = config.prefix;
  return (
    (useDescription ? `I'm ${config.botName}, an custom multiple-choice adventure game.  Play an example game, or an existing game, or upload your own game in a spreadsheet.\n` : '\n') +
    `\nUsage:\n` +
    `\t**${prefix}games** \n\t\tlists current games\n` +
    `\t**${prefix}addgame** [upload spreadsheet]\n` +
    `\t**${prefix}removegame** [gamename]\n` +
    `\t**${prefix}play** [gamename]\n` +
    `\t**${prefix}continue**\t\treprint last step in game\n` +
    `\t**${prefix}restart** [gamename]\n` +
    `\t**${prefix}choose** [choice]\n` +
    `\t**${prefix}**[choice]\n` +
    ''
  );
};

function getAddGameUsage() {
  return (
    `\n` +
    `**spreadsheet filetypes:** (XLSB/XLSX/XLSM/XLS/XML) and ODS\n` +
    `**spreadsheet format:**\n` +
    '```' +
    `game   \t[gameId]    \t[gameName]  \t[gameImage]  \t[gameDescription]\n` +
    `step   \t[stepId]    \t[stepText]  \t[stepOptionalImage]\n` +
    `choice \t[choiceId]  \t[choiceName] \t[choiceText] \t[nextStepId]\n` +
    `choice \t[choiceId]  \t[choiceName] \t[choiceText] \t[nextStepId]\n` +
    `step   \t[stepId]    \t[stepText]  \t[stepOptionalImage]\n` +
    `choice \t[choiceId]  \t[choiceName] \t[choiceText] \t[nextStepId]\n` +
    `choice \t[choiceId]  \t[choiceName] \t[choiceText] \t[nextStepId]\n` +
    `...\n\n` +
    '```' +
    `**example:**\n` +
    '```' +
    `game	  \tdive          \tA diving game about life   \t[http...image.png]   \tCan you see the view only you can see?\n` +
    `step	  \tdragon        \tYou see a diving board like a dragon\n` +
    `choice	\tdragon1       \tGo        \tGo to Diving School     \tdivingSchool\n` +
    `choice	\tdragonb       \tLife      \tFind a different hobby  \tformlessSnow\n` +
    `step	  \tdivingSchool  \tgo to diving school\n` +
    `choice	\tdivingSchool1 \tPractice  \tPractice a little       \tformlessSnow\n` +
    `choice	\tdivingSchool2 \tTrain     \tTrain hard              \tviewSee\n` +
    `step	  \tformlessSnow  \tFormless snow\n` +
    `step	  \tviewSee       \tYou see the view only you can see.\n` +
    '```'
  );
}

const spreadsheetExtensions = ['xlsb','xlsx','xlsm','xls','xml','ods'];

function removeGame(message, gameId) {
  const hasAdmin = message.member.permissions.has('ADMINISTRATOR');
  if (!gameId) {
    message.channel.send(`removeGame needs a gameId\n try removeGame [gameId]`);
    return;
  }
  const db = getDb(message);
  if (!db) return;
  const dbGameId = hashName(gameId);
  db.collection('games').findOne({_id: dbGameId}, function(err, result) {
    if (result) {
      if (result.addedBy && result.addedBy.id && result.addedBy.id !== message.author.id) {
        if (!admin) {
          message.channel.send(`Must be the game adder or have admin permissions to remove game`);
          return null;
        }
      }
      db.collection('games').remove({_id: dbGameId}, function(err, result) {
        message.channel.send(`Game ${gameId} removed.  use '${config.prefix}games' to see the list of games'`);
      });
    } else {
      message.channel.send(`No game with gameId ${gameId} found`);
    }
  });
}

function addGame(message) {
  if (message.attachments.size < 1) {
    message.channel.send('Attach a spreadsheet with the message to addgame \n' + getAddGameUsage());
    return;
  } else if (message.attachments.size > 1) {
    message.channel.send('Attach one attachment at a time to addgame \n' + getAddGameUsage());
    return;
  }
  const attachment = message.attachments.values().next().value;
  const filename = attachment.filename;
  const attachmentFormat = filename.substr(filename.lastIndexOf('.') + 1);
  if (spreadsheetExtensions.indexOf(attachmentFormat) < 0) {
    message.channel.send('Spreadsheet extension not recognized \n' + getAddGameUsage());
    return;
  }
  if (attachment.filesize > 21000000) {
    message.channel.send('Game attachment is too large. \n' + getAddGameUsage());
    return;
  }
  const attachmentUrl = attachment.url;
  request(attachmentUrl, {encoding: null}, function(err, res, data) {
  	if (err || res.statusCode !== 200) {
      message.channel.send('Error downloading attachment. \n');
      return;
    }
  	// data is a node Buffer that can be passed to XLSX.read
  	const workbook = XLSX.read(data, {type:'buffer'});
    if (!workbook) {
      message.channel.send('Error reading spreadsheet. \n' + getAddGameUsage());
    }

    const worksheet = workbook.Sheets[workbook.SheetNames[0]];

    const sheetJson = XLSX.utils.sheet_to_json(worksheet, {header:1});
    const gameInfo = parseGameFromSheetJson(message, sheetJson);
    if (gameInfo) {
      addGameToDb(message, gameInfo);
    }
  });
}

function testAddGame(message) {
  const sheetJson = [ [ 'game',
    'divetest',
    'A diving game about life',
    'https://upload.wikimedia.org/wikipedia/commons/e/e5/Solid_blue.png',
    'Can you see the view only you can see?' ],
  [ 'step',
    'dragon',
    'You see a diving board like a dragon',
    'https://upload.wikimedia.org/wikipedia/commons/e/e5/Solid_blue.png'],
  [ 'choice',
    'dragon 1',
    'Go',
    'Go to Diving School',
    'divingSchool' ],
  [ 'choice',
    'dragonb',
    'Life',
    'Find a different hobby',
    'formless Snow' ],
  [ 'step',
    'divingSchool',
    'go to diving school' ],
  [ 'choice',
    'divingSchool1',
    'Practice',
    'Practice a little ',
    'formless Snow' ],
  [ 'choice', 'divingSchool2', 'Train ', 'Train hard', 'viewSee' ],
  [ 'step',
    'formless Snow',
    'Formless snow' ],
  [ 'step', 'viewSee', 'You see the view only you can see.' ] ];
  const gameInfo = parseGameFromSheetJson(message, sheetJson);
  if (gameInfo) {
    addGameToDb(message, gameInfo);
  }
}

function parseGameFromSheetJson(message, sheetJson) {
  const gameInfo = {};
  if (!sheetJson) {
    message.channel.send('Error parsing spreadsheet. \n' + getAddGameUsage());
  }
  const numRows = sheetJson.length;
  if (sheetJson.length < 2 ) {
    message.channel.send('Spreadsheet must have at least 2 rows. \n' + getAddGameUsage());
  }
  // trim all
  sheetJson.forEach(row => {
    for (let ind = 0; ind > row.length; ind++) {
      if (row[ind] && row[ind].trim) {
        grow[ind] = row[ind].trim();
      }
    }
  });
  //parse game info at top
  const gameRow = sheetJson[0];
  if (gameRow.length != 5) {
    message.channel.send('Spreadsheet game row must have 5 values including game. \n' + getAddGameUsage());
    return null;
  }
  if (!gameRow[0] || gameRow[0] !== 'game') {
    message.channel.send('Spreadsheet must start with a game row. \n' + getAddGameUsage());
    return null;
  }
  const gameHeader = {
    id: gameRow[1],
    name: gameRow[2],
    image: gameRow[3],
    description: gameRow[4],
  }
  if (typeof gameHeader.name !== 'string') {
    message.channel.send('game id label must be a text string. \n' + getAddGameUsage());
    return null;
  }
  if (typeof gameHeader.name !== 'string') {
    message.channel.send('game name must be a text string. \n' + getAddGameUsage());
    return null;
  }
  if (typeof gameHeader.image !== 'string') {
    message.channel.send('game image must be a url. \n' + getAddGameUsage());
    return null;
  }
  if (typeof gameHeader.description !== 'string') {
    message.channel.send('game description must be a text string. \n' + getAddGameUsage());
    return null;
  }
  gameInfo.info = gameHeader;

  // validate that the second row is a step row
  {
    let curRowInd = 1;
    const curRow = sheetJson[curRowInd];
    if (!curRow[0] || curRow[0] !== 'step') {
      message.channel.send('Spreadsheet second row must be a step row. \n' + getAddGameUsage());
      return null;
    }
  }

  // parse all steps and options
  const steps = {};
  gameInfo.steps = steps;
  let lastStep;
  for (let curRowInd = 1; curRowInd < numRows; curRowInd++) {
    const curRow = sheetJson[curRowInd];
    const rowType = curRow[0];
    if (rowType === 'step') {
      if (curRow.length < 3) {
        message.channel.send(`Row ${curRowInd}: step row must have at least 3 values including step. \n` + getAddGameUsage());
        return null;
      }
      const curStep = {
        stepId: curRow[1],
        stepText: curRow[2],
        choices: {},
      }
      if (curRow.length > 3) {
        curStep.optionalImage = curRow[3];
      }
      if (typeof curStep.stepId !== 'string') {
        message.channel.send(`Row ${curRowInd}: step name must be a text string. \n` + getAddGameUsage());
        return null;
      }
      if (typeof curStep.stepText !== 'string') {
        message.channel.send(`Row ${curRowInd}: step id must be a text string. \n` + getAddGameUsage());
        return null;
      }
      if (curStep.optionalImage && typeof curStep.optionalImage !== 'string') {
        message.channel.send(`Row ${curRowInd}: step image must be a text url. \n` + getAddGameUsage());
        return null;
      }
      if (!lastStep) {
        gameInfo.firstStepId = curStep.stepId;
      }
      lastStep = curStep;
      steps[curStep.stepId] = curStep;
    } else if (rowType === 'choice') {
      if (curRow.length !== 5) {
        message.channel.send(`Row ${curRowInd}: choice row must have 5 values including choice. \n` + getAddGameUsage());
        return null;
      }
      const curChoice = {
        choiceId: curRow[1],
        choiceName: curRow[2],
        choiceText: curRow[3],
        nextStepId: curRow[4],
      }
      if (typeof curChoice.choiceId !== 'string') {
        message.channel.send(`Row ${curRowInd}: choice id must be a text string. \n` + getAddGameUsage());
        return null;
      }
      if (typeof curChoice.choiceName !== 'string') {
        message.channel.send(`Row ${curRowInd}: choice name must be a text string. \n` + getAddGameUsage());
        return null;
      }
      if (typeof curChoice.choiceText !== 'string') {
        message.channel.send(`Row ${curRowInd}: choice id must be a text string. \n` + getAddGameUsage());
        return null;
      }
      if (typeof curChoice.nextStepId !== 'string') {
        message.channel.send(`Row ${curRowInd}: choice image must be a text url. \n` + getAddGameUsage());
        return null;
      }
      lastStep.choices[curChoice.choiceId] = curChoice;
    } else {
      message.channel.send(`Row ${curRowInd}: unrecognized row type, must be step or choice. \n` + getAddGameUsage());
      return null;
    }
  }
  return gameInfo;
}

function hashName(str){
  let hash = 0;
  if (str.length == 0) return hash;
  for (i = 0; i < str.length; i++) {
    char = str.charCodeAt(i);
    hash = ((hash<<5)-hash)+char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}

function addGameToDb(message, gameInfo) {
  const db = getDb(message);
  if (!db) return;
  const gameId = gameInfo.info.id;
  const dbGameId = hashName(gameId);
  const addedByUserId = message.author.id;
  const addedByUsername = message.author.username;
  gameInfo.addedBy = {
    username: addedByUsername,
    id: addedByUserId,
    inNsfw: message.channel.nsfw,
  }
  gameInfo._id = dbGameId;
  db.collection('games').findOne({_id: dbGameId}, function(err, result) {
    if (result) {
      if (result.addedBy && result.addedBy.id && result.addedBy.id !== addedByUserId) {
        message.channel.send(`Game ${gameId} already exists.\n Ask ${result.addedBy.username} or an admin to update or remove it`);
        return null;
      }
      db.collection('games').replaceOne({_id: dbGameId}, function(err, result) {
        message.channel.send(`Game ${gameId} replaced with new game.  use '${config.prefix}games' to see the list of games'`);
      });
    } else {
      db.collection('games').insert(gameInfo);
      message.channel.send(`Added game ${gameId}.  use '${config.prefix}games' to see the list of games'`);
    }
  });
}

function getDb(message){
  if (!myClient) {
    message.channel.send(`db is not connected to bot. \n`);
    return null;
  }
  const client = myClient;
  const groupId = message.channel.guild.id;
  const db = client.db(`${config.dbNamePrefix}${groupId}`);
  initCollections(db);
  return db;
}

function continueGame(message) {
  const db = getDb(message);
  if (!db) return;
  const userId = message.author.id;
  db.collection('state').findOne({_id: userId}, function(err, result) {
    if (!result) {
      message.channel.send(`No current game progress found.  use '${config.prefix}games' to see the list of games'`);
      return;
    }
    if (result) {
      const state = result;
      let lastGameId = state && state.lastGameId;
      const id = lastGameId;
      if (!lastGameId) {
        message.channel.send(`No current game progress found.  use '${config.prefix}games' to see the list of games'`);
        return;
      }
      if (lastGameId) {
        playGame(message, undefined, false, lastGameId);
      }
    }
  });
}

function playGame(message, gameId, doRestart, dbGameId) {
  const db = getDb(message);
  if (!db) return;
  if (!gameId && !dbGameId) {
    message.channel.send(`Command needs a game id'`);
  }
  if (!dbGameId) {
    dbGameId = hashName(gameId);
  }
  const userId = message.author.id;
  let lastStepId;
  db.collection('games').findOne({_id: dbGameId}, function(err, result) {
    if (result) {
      const gameInfo = result;
      lastStepId = gameInfo.firstStepId;
      if (!gameId) {
        gameId = gameInfo.info.id;
      }
      if ((gameInfo.addedBy && gameInfo.addedBy.inNsfw) && !message.channel.nsfw) {
        message.channel.send(`Can't play a game added in an nsfw chat in a non-nsfw chat`);
        return;
      }
      db.collection('state').findOne({_id: userId}, function(err, result) {
        if (result) {
          const state = result;
          const gameState = state && state.gameState && state.gameState[dbGameId];
          if (!doRestart && gameState && gameState.lastStepId) {
            lastStepId = gameState.lastStepId;
          }
        }
        const setValues = {
          lastGame: dbGameId,
        }
        if (doRestart) {
          setValues[`gameState.${dbGameId}.lastStepId`] = gameInfo.firstStepId;
        }
        db.collection('state').updateOne({_id: userId}, {$set: setValues}, {upsert: true}, function(err, result) {
          const curStep = gameInfo.steps[lastStepId];
          showStep(message, gameInfo, curStep);
          return;
        });
      });
    } else {
      message.channel.send(`Game id ${gameId} not found in list of games`);
    }
  });
}

function showStep(message, gameInfo, curStep) {
  const gameId = gameInfo && gameInfo.info && gameInfo.info.id;
  if (!curStep) {
    message.channel.send(`Can't find current step in game ${gameId}.\n to restart type **${config.prefix}restart ${gameId}** `);
    return;
  }
  // send main step description
  message.channel.send(curStep.stepText);
  // send optional image in an embed
  if (curStep.optionalImage) {
    let embed = new Discord.RichEmbed()
      .setColor(0x303833)
      .setImage(curStep.optionalImage);
    message.channel.send({embed});
  }
  // send all choices and a help footer
  const choices = curStep.choices;
  const choiceIds = Object.keys(choices);
  if (choiceIds && choiceIds.length > 0) {
    let embed = new Discord.RichEmbed()
      .setColor(0x2f4136);
    choiceIds.forEach(choiceId => {
      const choice = choices[choiceId];
      embed = embed.addField(`${choice.choiceId}:`, `${choice.choiceText}`)
    });
    embed = embed.setFooter(`${config.prefix}choose [choiceId]`);
    message.channel.send({embed});
  } else {
    const gameName = gameInfo && gameInfo.info && gameInfo.info.name;
    let embed = new Discord.RichEmbed()
      .setTitle(`Ending Reached: ${gameName}`)
      .setColor(0x2f4136);
    embed = embed.setFooter(`${config.prefix}restart ${gameId}`);
    message.channel.send({embed});
  }
}

function checkCurrentGameCommands(message, gameCommand, bigGameCommand, isChoose, notFoundCallback) {
  const db = getDb(message);
  if (!db) return;
  const userId = message.author.id;
  db.collection('state').findOne({_id: userId}, function(err, result) {
    if (!result && notFoundCallback) {
      notFoundCallback();
      return;
    }
    if (result) {
      const state = result;
      let lastGameId = state && state.lastGameId;
      const dbGameId = lastGameId;
      if (!lastGameId && notFoundCallback) {
        notFoundCallback();
        return;
      }
      if (lastGameId) {
        db.collection('games').findOne({_id: dbGameId}, function(err, result) {
          if (result) {
            const gameInfo = result;
            const gameState = state && state.gameState && state.gameState[dbGameId];
            const lastStepId = (gameState && gameState.lastStepId) || gameInfo.firstStepId;
            const curStep = lastStepId && gameInfo.steps[lastStepId];
            if (!curStep) {
              if (isChoose) {
                message.channel.send(`current step not found in game ${gameInfo.info.id}\n try **${config.prefix}restart ${gameInfo.info.id}**`);
              }
              return;
            }
            const choices = curStep.choices;
            const choiceIds = Object.keys(choices);
            let foundChoice = false;
            for (let index = 0; index < choiceIds.length; index++) {
              const choiceId = choiceIds[index];
              if (choiceId === gameCommand || choiceId === bigGameCommand) {
                if ((gameInfo.addedBy && gameInfo.addedBy.inNsfw) && !message.channel.nsfw) {
                  message.channel.send(`Can't play a game added in an nsfw chat in a non-nsfw chat`);
                  return;
                }
                foundChoice = true;
                const choice = choices[choiceId];
                const nextStepId = choice.nextStepId;
                const nextStep = gameInfo.steps[nextStepId];
                if (!nextStep) {
                  message.channel.send(`next step not found in game ${gameInfo.info.id}\n could be game error ask ${gameInfo.info.addedBy.username} or try another choice**`);
                  return;
                }
                //set step;
                db.collection('state').updateOne({_id: userId}, {$set: {[`gameState.${dbGameId}.lastStepId`]: nextStepId}}, function(err, result) {
                  if (err){
                    console.log('gameState update err = ', err);
                  }
                  if (!result) {
                    message.channel.send(`error updating choice in db`);
                    return;
                  }
                  showStep(message, gameInfo, nextStep);
                  return;
                });
                break;
              }
            }
            if (!foundChoice) {
              if (isChoose) {
                message.channel.send(`choiceId ${gameCommand} not found\n\n`);
                showStep(message, gameInfo, curStep);
              } else if (notFoundCallback) {
                notFoundCallback(false);
              }
            }
          }
        });
      }
    }
  });
}

function updateGameWithCommand(message, command, args, notFoundCallback) {
  let gameCommand = command;
  let bigGameCommand = command + ' ' + args.join(' ');
  let isChoose = false;
  if (command === 'choose') {
    isChoose = true;
    if (!args || args.length < 1) {
      message.channel.send('choose needs a choiceId');
      if (command === 'choose') {
        return false;
      }
    }
    gameCommand = args[0];
    bigGameCommand = args.join(' ');
    args.splice(1);
  } else if (!gameCommand) {
    return false;
  }
  checkCurrentGameCommands(message, gameCommand, bigGameCommand, isChoose, notFoundCallback);
  return false;
}

// Use connect method to connect to the Server
MongoClient.connect(config.dbUrl, function (err, client) {
  if (err) {
    console.log('Unable to connect to the mongoDB server. Error:', err);
  } else {
    console.log('Connection established to', config.dbUrl);
    myClient = client;
  }
});

function initCollections(db) {
  db.createCollection("games", function(err, res) {
    if (err) {
      throw err;
    }
  });
  db.createCollection("state", function(err, res) {
    if (err) {
      throw err;
    }
  });
}

function showGamesList(message) {
  const db = getDb(message);
  if (!db) return;
  db.collection('games').find({}).toArray(function(err, result) {
    if (result) {
      let msg = 'List of games: \n\n';
      message.channel.send(msg);
      result.forEach(gameInfo => {
        if ((gameInfo.addedBy && gameInfo.addedBy.inNsfw) && !message.channel.nsfw) {
          //skip games added in nsfw channels in not nsfw channels
        } else {
          const embed = new Discord.RichEmbed()
            .setTitle(`${gameInfo.info.name}`)
            .setColor(0x00AE86)
            .setDescription(gameInfo.info.description)
            .setFooter(`${config.prefix}play ${gameInfo.info.id}`, gameInfo.info.image)
            .setThumbnail(gameInfo.info.image);
          message.channel.send({embed});
        }
      });
    } else if (err){
      message.channel.send(`Error getting games list from db`);
    } else {
      message.channel.send(`No games yet.  try adding a game: \n ${getAddGameUsage()}`);
    }
  });
}

bot.on('ready', function (evt) {
  console.log('connected');
});

bot.on('message', async message => {
  if (message.author.bot) {
    return;
  }
  const prefix = config.prefix;
  let prefixTrimmed = prefix.substr(0, prefix.length);
  prefixTrimmed = prefixTrimmed.trim();
  const { user, userID, channelID, content, evt } = message;
  let hasPrefix;
  let hasMention;
  if (content && content.substring(prefix, prefix.length) === prefix) {
    hasPrefix = true;
  } else if (content && content === prefixTrimmed) {
    hasPrefix = true;
  }
  if (message.mentions.users.has(config.botUserId)) {
    hasMention = true;
  }
  if (!hasPrefix && !hasMention) {
    return;
  }
  const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
  const command = args.shift();
  const lowerCommand = command.toLowerCase();

  if (!content) return;
  if (hasPrefix) {
    let isRegCommand = true;
    let gameId;
    switch(lowerCommand) {
      case 'help':
      case '-help':
      case '--help':
      case '':
        message.channel.send(getHelpMessage(true));
        break;
      case 'addgame':
        addGame(message);
        break;
      case 'testaddgame':
        testAddGame(message);
        break;
      case 'removegame':
        gameId = args && args.length > 0 && args[0]
        removeGame(message, gameId);
        break;
      case 'games':
        showGamesList(message);
        break;
      case 'continue':
      case 'resume':
        continueGame(message);
        break;
      case 'start':
      case 'play':
        gameId = args && args.length > 0 && args[0];
        playGame(message, gameId);
        break;
      case 'restart':
        gameId = args && args.length > 0 && args[0];
        playGame(message, gameId, true);
        break;
      case 'choose':
        updateGameWithCommand(message, command, args);
        break;
      default:
        isRegCommand = false;
    }
    const isCustomCommand = checkCustomCommands && checkCustomCommands(message, command, args);
    if (!isRegCommand && !isCustomCommand) {
      updateGameWithCommand(message, command, args, function(){
        message.channel.send(`${config.unknownCommandString} \n` + getHelpMessage());
      });
    }
  } else if (hasMention) {
    message.channel.send(getHelpMessage(true));
  }
});

bot.login(config.token);
