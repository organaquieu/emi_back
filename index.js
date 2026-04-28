<<<<<<< HEAD
const express = require('express');

const app = express();
const PORT = 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'Backend works!' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
=======
const express = require('express');

const app = express();
const PORT = 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'Backend works!' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
>>>>>>> acbf8526c2f17c39e020c1909c60d2a858310090
});