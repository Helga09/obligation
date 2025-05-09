const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const mongoose = require('mongoose');
const cron = require('node-cron');

const app = express();

// Підключення до MongoDB
mongoose.connect(process.env.MONGO_URL || 'mongodb://localhost:27017/bonds', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Модель для цін
const Price = mongoose.model('Price', new mongoose.Schema({
  isin: String,
  timestamp: { type: Date, default: Date.now },
  price: Number,
}));

// Облігації, які потрібно відслідковувати
const ISINS = [
  'UA4000234223',
  'UA4000207518'
];

// Функція парсингу
async function scrapePrice() {
  try {
    const { data } = await axios.get('https://uainvest.com.ua/ukrbonds?broker=sense');
    const $ = cheerio.load(data);

    $('table tbody tr').each((_, row) => {
      const cells = $(row).find('td').map((_, td) => $(td).text().trim()).get();
      const isin = cells[1];
      const priceStr = cells[5];

      if (ISINS.includes(isin)) {
        const price = parseFloat(priceStr.replace(',', ''));
        if (!isNaN(price)) {
          Price.create({ isin, price });
          console.log(`[✓] ${isin} => ${price}`);
        }
      }
    });
  } catch (err) {
    console.error('[!] Помилка парсингу:', err.message);
  }
}

// Збираємо щохвилини (для тесту) — поміняєш на '0 16 * * *' для 16:00
cron.schedule('* * * * *', scrapePrice);

// // Вебінтерфейс
// app.get('/', async (req, res) => {
//   const allPrices = await Price.find().sort({ timestamp: 1 });
//   const grouped = {};

//   allPrices.forEach(p => {
//     if (!grouped[p.isin]) grouped[p.isin] = [];
//     grouped[p.isin].push(p);
//   });

//   let chartsHtml = '';
//   for (const [isin, records] of Object.entries(grouped)) {
//     const labels = records.map(r => r.timestamp.toISOString().split('T')[0]);
//     const prices = records.map(r => r.price);
//     const canvasId = `chart_${isin}`;

//     chartsHtml += `
//       <h3>${isin}</h3>
//       <canvas id="${canvasId}" width="800" height="300"></canvas>
//       <script>
//         new Chart(document.getElementById('${canvasId}').getContext('2d'), {
//           type: 'line',
//           data: {
//             labels: ${JSON.stringify(labels)},
//             datasets: [{
//               label: 'Ціна (UAH)',
//               data: ${JSON.stringify(prices)},
//               borderColor: 'blue',
//               fill: false,
//               tension: 0.1
//             }]
//           }
//         });
//       </script>
//     `;
//   }

//   res.send(`
//     <!DOCTYPE html>
//     <html>
//     <head>
//       <title>Облігації</title>
//       <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
//     </head>
//     <body>
//       <h2>Графіки облігацій</h2>
//       ${chartsHtml}
//     </body>
//     </html>
//   `);
// });

app.get('/', async (req, res) => {
    const allPrices = await Price.find().sort({ timestamp: 1 });
    const grouped = {};
  
    allPrices.forEach(p => {
      if (!grouped[p.isin]) grouped[p.isin] = [];
      grouped[p.isin].push(p);
    });
  
    const labelsSet = new Set();
    const datasets = [];
  
    for (const [isin, records] of Object.entries(grouped)) {
      const labelPoints = records.map(r => r.timestamp.toISOString().split('T')[0]);
      labelPoints.forEach(l => labelsSet.add(l));
  
      datasets.push({
        label: isin,
        data: records.map(r => ({ x: r.timestamp.toISOString().split('T')[0], y: r.price })),
        borderColor: '#' + Math.floor(Math.random()*16777215).toString(16),
        hidden: false,
        tension: 0.1,
        fill: false
      });
    }
  
    const labels = Array.from(labelsSet).sort();
  
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Облігації</title>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      </head>
      <body>
        <h2>Графік облігацій</h2>
        <label for="isinSelect">Оберіть ISIN:</label>
        <select id="isinSelect">
          <option value="all">Всі</option>
          ${Object.keys(grouped).map(isin => `<option value="${isin}">${isin}</option>`).join('')}
        </select>
  
        <canvas id="allChart" width="900" height="400"></canvas>
  
        <script>
          const ctx = document.getElementById('allChart').getContext('2d');
          const datasets = ${JSON.stringify(datasets)};
          const allChart = new Chart(ctx, {
            type: 'line',
            data: {
              datasets: datasets
            },
            options: {
              responsive: true,
              parsing: {
                xAxisKey: 'x',
                yAxisKey: 'y'
              },
              scales: {
                x: {
                  type: 'category',
                  title: { display: true, text: 'Дата' }
                },
                y: {
                  title: { display: true, text: 'Ціна (UAH)' }
                }
              }
            }
          });
  
          document.getElementById('isinSelect').addEventListener('change', (e) => {
            const value = e.target.value;
            allChart.data.datasets.forEach(ds => {
              ds.hidden = (value !== 'all' && ds.label !== value);
            });
            allChart.update();
          });
        </script>
      </body>
      </html>
    `);
  });
  

// Запуск сервера
app.listen(3000, () => {
  console.log('Сервер запущено на http://localhost:3000');
});
