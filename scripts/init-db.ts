import dotenv from 'dotenv'; import fs from 'fs';
dotenv.config({path:'.env.local'});
(async()=>{const {pool}=await import('../lib/db');await pool.query(fs.readFileSync('db/schema.sql','utf8'));await pool.end();console.log('Database ready');})().catch(e=>{console.error(e);process.exit(1)});
