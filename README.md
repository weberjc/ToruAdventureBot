# ToruAdventureBot
ToruAdventureBot is a Discord bot for sharing custom multiple-choice adventure games.

People in the chat can add their own game by uploading a spreadsheet.

Anyone member can play the games that have been added.

![](https://i.imgur.com/CnEU22o.png)

## Requirements
Uses:
* Node.js
* MongoDB >= 3.0

## Usage
    toru games
      lists current games
    toru addgame [spreadsheet attachment]
    toru removegame [gamename]
    toru play [gamename]
    toru restart [gamename]
    toru choose [choice]
    toru [choice]


# Game Spreadsheet format
  | Spreadsheet|              |                |                |                   |
  | ---------- | ------------ | -------------- | -------------- | ----------------- |
  |  game      | [gameId]     | [gameName]    | [gameImage]     | [gameDescription] |
  |  step      | [stepId]     | [stepText]    | [optionalImage] |                   |
  |  choice    | [choiceId]   | [choiceName]  | [choiceText]    | [nextStepId]      |
  |  choice    | [choiceId]   | [choiceName]  | [choiceText]    | [nextStepId]      |
  |  step      | [stepId]     | [stepText]    | [optionalImage] |                   |
  |  choice    | [choiceId]   | [choiceName]  | [choiceText]    | [nextStepId]      |
  |  choice    | [choiceId]   | [choiceName]  | [choiceText]    | [nextStepId]      |

# To Use:
* copy config.json.example to config.json and add in a discord bot token
* copy checkCustomCommands.js.example to checkCustomCommands.js
* modify the dbUrl in config.json to be a url in the cloud if desired.
