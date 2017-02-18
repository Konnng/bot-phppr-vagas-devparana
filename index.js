var GitHubApi = require('github-api-node')
var fs = require('fs-extra')
var path = require('path')
var Slack = require('slack-node')
var moment = require('moment')
var lowDb = require('lowdb')
var lowDbFileAsync = require('lowdb/lib/storages/file-async')
var sleep = require('system-sleep')

var slackWebHook = process.env.LABS_SLACK_WEBHOOK_URL_DEVPARANA_BOT_PR || ''
var dbFile = path.join(__dirname, 'data/db.json')

try {
  if (!fs.existsSync(path.dirname(dbFile)) && !fs.mkdirsSync(path.dirname(dbFile))) {
    throw new Error('Error creating data dir.')
  } else if (!slackWebHook) {
    throw new Error('Slack Webhook not found in enviroment variables. Aborting...')
  }

  var db = lowDb(dbFile, { storage: lowDbFileAsync, writeOnChange: true })
  var github = new GitHubApi({})
  var slack = new Slack()
  slack.setWebhook(slackWebHook)

  db.defaults({ jobs: [], settings: {} }).write()

  var jobs = db.get('jobs').value().map(item => item.id)
  var issues = github.getIssues('phppr', 'vagas')

  issues.list({}, (err, data) => {
    if (err) {
      throw err
    }

    data.filter(item => jobs.indexOf(item.id) < 0).forEach(item => {
      var id = item.id
      var title = item.title
      var url = item.html_url
      var labels = item.labels.map(label => label.name)
      var date = moment(item.created_at).unix()
      var dateProcessed = moment().unix()
      var botProcessed = false

      var row = { id, title, url, labels, date, dateProcessed, botProcessed }

      db.get('jobs').push(row).write()
    })
  })

  jobs = db.get('jobs').value().filter(item => !item.botProcessed).map((item, index) => {
    slack.webhook({
      attachments: [
        {
          title: item.title,
          title_link: item.url,
          text: 'Vaga: ' + item.title + '\nData: ' + moment(item.date).format('DD/MM/YYYY') + '\nDetalhes: ' + item.labels.join(', '),
          color: '#7CD197'
        }
      ],
      text: 'Vaga de trabalho encontrada. Confira! \n\n' + item.url
    }, (err, response) => {
      if (err) {
        throw err
      }
      if (response.statusCode === 200) {
        _log('Done posting item ' + (index + 1))
        db.get('jobs').find({ id: item.id }).assign({ bot_processed: true }).write()
      } else {
        throw new Error('Error processing item ' + (index + 1) + ': ' + response.statusCode + ': ' + response.statusMessage)
      }
    })

    sleep(1000)
  })
} catch (err) {
  _log('ERROR: ', err)
  _log('ERROR: ', '-'.repeat(100))
}

function _log () {
  console.log.apply(console, [].concat([`[${moment().format('DD/MM/YYYY HH:mm:ss')}] =>`], Array.from(arguments) || []))
}
