const config = require('config')
const { Pool, Query } = require('pg')

// config constants (connection should be read when needed)
const relations = config.get('relations')

let pools = {}

for (relation of relations){
    const [database, schema, view] = relation.split('::')

    if(!pools[database]){ //connection should be done based on the data base. If there are databases in two different server but in the same name, we need to change the script.
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
        //let sql = `SELECT count(*) FROM ${schema}.${view} `
        //let sql = `SELECT * FROM ${schema}.${view} limit 1`
        let sql = `SELECT column_name FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${view}' ORDER BY ordinal_position`
        let res = await client.query(sql)
        let sql2 = `SELECT count(*) FROM ${schema}.${view}`
        let res2 = await client.query(sql2)
        res = res.rows.map(r => r.column_name)
        res2 = res2.rows.map(r => r.count)
        //await setTimeout(function(){
        //    console.log("Test")
        //}, 2000)
        console.log(`-------------------\n${database}::${schema}::${view}:\n - has ${res2} records. \n - has the following columns:\n ${res}`)
        await client.end()
        release()
    })    
}