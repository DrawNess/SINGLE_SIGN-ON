const express = require('express');
const app = express();
const port = 2106;
app.get('/', (req, res) => {
  res.send('Hello, World!');
});

app.get('/nueva-ruta', (req, res) => {
  res.json({ message: 'Nueva ruta!' });
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
