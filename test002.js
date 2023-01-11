// libraries
const config = require('config')
const { spawn } = require('child_process')
const fs = require('fs')
const { Pool, Query } = require('pg')
const Spinner = require('cli-spinner').Spinner
const modify = require('./modify.js')

// config constants
const relations = config.get('relations')
const outputDir = 'out-text'
const spinnerString = config.get('spinnerString')
const fetchSize = config.get('fetchSize')



// global configurations
Spinner.setDefaultSpinnerString(spinnerString)


// global variable
let idle = true
let pools = {}


const isIdle = () => {
  return idle
}

const iso = () => {
  return (new Date()).toISOString()
}

const noPressureWrite = (downstream, f) => {
  return new Promise((res) => {
    if (downstream.write(`\x1e${JSON.stringify(f)}\n`)) {
      res()
    } else {
      downstream.once('drain', () => { 
        res()
      })
    }
  })
}

const fetch = (client, database, schema, table, downstream) => {
  return new Promise((resolve, reject) => {
    let count = 0
    let features = []
    client.query(new Query(`FETCH ${fetchSize} FROM cur`))
    .on('row', row => {
      let f = {
        type: 'Feature',
        properties: row,
        geometry: JSON.parse(row.st_asgeojson)
      }
      delete f.properties.st_asgeojson
      f.properties._database = database
      f.properties._schema = schema
      f.properties._table = table
      count++
      f = modify(f)
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
      downstream.end()
      resolve(count)
    })
  })
}

for (relation of relations){
  const [database, schema, table] = relation.split('::')
  const stream = fs.createWriteStream(`${outputDir}/${database}-${schema}-${table}.txt`)
  if (!pools[database]) {
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
    let sql = `SELECT column_name FROM information_schema.columns WHERE table_name='${table}' AND table_schema='${schema}' ORDER BY ordinal_position`
      let cols = await client.query(sql)
      cols = cols.rows.map(r => r.column_name).filter(r => r !== 'geom')
      //cols = cols.filter(v => !propertyBlacklist.includes(v))
      //test--------------------------
      if (table == 'unmap_wbya10_a'){
        cols.push(`ST_Area(${schema}.${table}.geom) AS areacalc`)
        cols.push(`ST_Length(${schema}.${table}.geom) AS lengthcalc`)
      }
      if (table == 'unmap_dral10_l'){
        cols.push(`ST_Length(${schema}.${table}.geom) AS lengthcalc`)
      }     
      //until here--------------------
      cols.push(`ST_AsGeoJSON(${schema}.${table}.geom)`)
      await client.query(`BEGIN`)
      sql = `
      DECLARE cur CURSOR FOR 
      SELECT ${cols.toString()} FROM ${schema}.${table}` 
      cols = await client.query(sql)
      try {
        while (await fetch(client, database, schema, table, stream) !== 0) {}
      } catch (e) {
        throw e
      }
      await client.query(`COMMIT`)
      console.log(`${iso()}: finished ${relation}`)
      release()
})
}


