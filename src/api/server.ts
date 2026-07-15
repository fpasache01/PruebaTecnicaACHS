import { app } from './app.js';

const DEFAULT_PORT = 3000;
const port = Number.parseInt(process.env.PORT ?? `${DEFAULT_PORT}`, 10);

app.listen(port, () => {
  console.log(`ACHS Benefit API listening on port ${port}`);
});
