const express=require('express');
const fs=require('fs');
const path=require('path');
const app=express();
const PORT=process.env.PORT||3000;

app.use(express.json());
app.use(express.static(__dirname));

const FILE='./data.json';

app.get('/api/data',(req,res)=>{
 res.json(JSON.parse(fs.readFileSync(FILE)));
});

app.post('/api/practices',(req,res)=>{
 const d=JSON.parse(fs.readFileSync(FILE));
 d.practices=req.body;
 fs.writeFileSync(FILE,JSON.stringify(d,null,2));
 res.sendStatus(200);
});

app.listen(PORT,()=>console.log('running '+PORT));
