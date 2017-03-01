let GitHubApi = require('github-api-node')
let fs = require('fs-extra')
let path = require('path')
let Slack = require('slack-node')
let moment = require('moment')
let lowDb = require('lowdb')
let lowDbStorage = require('lowdb/lib/storages/file-sync')
let sleep = require('system-sleep')
let Q = require('q')

let slackWebHook = process.env.LABS_SLACK_WEBHOOK_URL_DEVPARANA_BOT_PR || ''
let dbFile = path.join(__dirname, 'data/db.json')

try {
  _log('Searching for new job offers...')

  if (!fs.existsSync(path.dirname(dbFile)) && !fs.mkdirsSync(path.dirname(dbFile))) {
    throw new Error('Error creating data dir.')
  } else if (!slackWebHook) {
    throw new Error('Slack Webhook not found in enviroment variables. Aborting...')
  }

  let db = lowDb(dbFile, { storage: lowDbStorage })
  let github = new GitHubApi({})
  let slack = new Slack()
  let deferred = Q.defer()
  slack.setWebhook(slackWebHook)

  db.defaults({ jobs: [], settings: {} }).write()

  let savedJobs = db.get('jobs').map('id').value() || []
  let issues = github.getIssues('phppr', 'vagas')

  issues.list({}, (err, data) => {
    if (err) {
      throw err
    }

    data.filter(item => savedJobs.indexOf(item.id) < 0).forEach(item => {
      let id = item.id
      let title = item.title
      let url = item.html_url
      let labels = item.labels.map(label => label.name)
      let date = moment(item.created_at).unix()
      let dateProcessed = moment().unix()
      let botProcessed = false

      let row = { id, title, url, labels, date, dateProcessed, botProcessed }

      db.get('jobs').push(row).write()
      sleep(100)
    })
    sleep(500)

    let jobs = db.get('jobs').value().filter(item => !item.botProcessed)
      .filter((item, index, self) => index === self.findIndex(_item => item.id === _item.id))

    deferred.resolve(jobs)
  })

  Q.when(deferred.promise, (jobs) => {
    _log(`Found ${jobs.length} job offers.`)
    if (jobs.length) {
      _log('Processing items to send to slack...')
    }

    jobs.forEach((item, index) => {
      _log('Processing item ' + (index + 1))
      slack.webhook({
        attachments: [{
          title: item.title,
          title_link: item.url,
          text: 'Vaga: ' + item.title + '\nData: ' + moment(item.date).format('DD/MM/YYYY') + '\nDetalhes: ' + item.labels.join(', '),
          color: '#7CD197'
        }],
        text: 'Vaga de trabalho encontrada. Confira! \n\n' + item.url
      }, (err, response) => {
        if (err) {
          throw err
        }
        if (response.statusCode === 200) {
          _log('Done posting item ' + (index + 1))
          _log('-'.repeat(100))
          db.get('jobs').find({ id: item.id }).assign({ botProcessed: true }).write()
        } else {
          throw new Error('Error processing item ' + (index + 1) + ': ' + response.statusCode + ': ' + response.statusMessage)
        }
      })
      sleep(1000)
    })
  })
} catch (err) {
  _log('ERROR: ', err)
  _log('-'.repeat(100))
}

function _log () {
  console.log.apply(console, [].concat([`[${moment().format('DD/MM/YYYY HH:mm:ss')}] =>`], Array.from(arguments) || []))
}
