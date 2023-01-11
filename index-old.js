//libraries
const config = require('config')
const { spawn } = require('child_process')
const fs = require('fs')
const pretty = require('prettysize')
const TimeFormat = require('hh-mm-ss')
const { Pool, Query } = require('pg')
const Spinner = require('cli-spinner').Spinner
const winston = require('winston')
const DailyRotateFile = require('winston-daily-rotate-file')
const Queue = require('better-queue')
const modify = require('./modify.js')

const relations = config.get('relations')
const fetchSize = config.get('fetchSize')
const outputDir = config.get('outputDir')
const logDir = 'log'
const tippecanoePath = config.get('tippecanoePath')

// global configurations
Spinner.setDefaultSpinnerString(1)
winston.configure({
    level: 'silly',
    format: winston.format.simple(),
    transports: [ 
        new DailyRotateFile({
            filename: `${logDir}/produce-clearmap-%DATE%.log`,
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '14d'
        }),
    ]
})

// global variable
let idle = true
let wtps
let modules = {}
let sar
let pools = {}
let productionSpinner = new Spinner()
let moduleKeysInProgress = []

const isIdle = () => {
    return idle
}

const iso = () => {
    return (new Date()).toISOString()
}

const noPressureWrite = (downstream, f) =>{
    return new Promise((res) => {
        if (downstream.write(`\x1e${JSON.stringify(f)}\n`)){
            res()
        } else {
            downstream.once('drain', () => {
                res()
            })
        }
    })
}

const fetch = (client, database, schema, view, downstream) => {
    return new Promise((resolve, reject) => {
        let count = 0
        let features = []
        client.query(new Query(`FETCH ${fetchSize} FROM cur`))
        .on('row', row =>{
            let f = {
                type: 'Feature',
                properties: row,
                geometry: JSON.parse(row.st_asgeojson),
                tippecanoe:{}
            }
            delete f.properties.st_asgeojson
            f.tippecanoe.layer='test'
            //f.properties._database = database
            //f.properties._table = table
            count++
            //f = modify(f)
            if (f) features.push(f)
        })
        .on('error', err => {
            console.error(err.stack)
            reject()
        })
        .on('end', async () => {
            for (f of features) {
                try {
                    await noPressureWrite(downstream, f)
                } catch (e) {
                    reject(e)
                }
            }
            resolve(count)
        })
    })
}

const dumpAndModify = async (relation, downstream) => {
    return new Promise((resolve, reject) =>{
        const [database, schema, view] = relation.split('::')
        if(!pools[database]){ //connection should be done based on the data base. If there are data
            pools[database] = new Pool({
                host: config.get(`connection.${database}.host`),
                user: config.get(`connection.${database}.dbUser`),
                port: config.get(`connection.${database}.port`),
                password: config.get(`connection.${database}.dbPassword`),
                database: database
            })
        }
        pools[database].connect(async (err, client, release) => {
            if (err) throw err
            let sql = `SELECT column_name FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${view}' ORDER BY ordinal_position`
            let cols = await client.query(sql)
            cols = cols.rows.map(r => r.column_name).filter(r => r !== 'geom')
            //Special edit (from here)
            if (view == 'unmap_wbya10_a'){
                cols.push(`ST_Area(${schema}.${view}.geom AS areacalc)`)
            }
            if (view == 'unmap_wbya10_a' || view == 'unmap_dral10_l') {
                cols.push(`ST_Length(${schema}.${view}.geom AS lengthcalc)`)
            }
            //Special edit (until here)
            cols.push(`ST_AsGeoJSON(${schema}.${view}.geom)`)
            await client.query('BEGIN')
            sql = `
            DECLARE cur CURSOR FOR 
            SELECT ${cols.toString()} FROM ${schema}.${view}`
            cols = await client.query(sql)
            try {
                while (await fetch(client, database, view, downstream) !== 0) {}
            } catch (e) {
                reject(e)
            }
            await client.query(`COMMIT`)
            winston.info(`${iso()}: finished ${database}::${schema}::${relation}.`)
            release()
            resolve()
        })
    })
}

const sleep = (wait) => {
    return new Promise((resolve, reject) => {
        setTimeout(() => { resolve() }, wait)
    })
}

const queue = new Queue(async (t, cb) =>{
    const data = t
    const startTime = new Date()
    const queueStats = queue.getStats()
    const tmpPath = `${outputDir}/part-clearmap.pmtiles`
    const dstPath = `${outputDir}/clearmap.pmtiles`

    productionSpinner.setSpinnerTitle(`I am now working on ${t} (^0^)/.....`)

    const tippecanoe = spawn(tippecanoePath,[
        '--quiet',
        '--no-feature-limit',
        '--no-tile-size-limit',
        '--force',
        '--simplification=2',
        '--drop-rate=1',
        '--minimum-zoom=0',
        '--maximum-zoom=5',
        '--base-zoom=5',
        '--hilbert',
        `--output=${tmpPath}`
    ], { stdio: ['pipe', 'inherit', 'inherit']})
    tippecanoe.on('exit', () => {
        fs.renameSync(tmpPath,dstPath)
        productionSpinner.stop()
        process.stdout.write('\n')
        const logString = `${iso()}: Process ${pretty(fs.statSync(dstPath).size)} took ${TimeFormat.fromMs(new Date() - startTime)}`
        winston.info(logString)
        console.log(logString) 
        return cb()
    })

    productionSpinner.start()

    for (relation of relations) {
        while (!isIdle()) {
            winston.info(`${iso()}: short break due to heavy disk writes.`)
            await sleep(5000)
        }
        try {
            await dumpAndModify(relation, tippecanoe.stdin)
        } catch (e) {
            winston.error(e)
            cb(true)
        }
       
    }
    tippecanoe.stdin.end()
}, {
    concurrent: 1,
    maxRetries: 1,
    retryDelay: 1000
})


const shutdown = () => {
    winston.info(`${iso()}: production system shutdown.`)
    console.log(`${iso()}: ** production system shudown! **`)
}


const main = async () => {
    winston.info(`${iso()}: production system started`)
    queue.push('clearmap')
    queue.on('drain', () => {
        shutdown()
    })
}

main()




