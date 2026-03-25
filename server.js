const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const FILE = './data.json';

app.get('/api/data', (req, res) => {
  const data = JSON.parse(fs.readFileSync(FILE));
  res.json(data);
});

app.post('/api/terms', (req, res) => {
  const data = JSON.parse(fs.readFileSync(FILE));
  data.terms.push(req.body);
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
