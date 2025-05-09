const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { Sequelize, DataTypes } = require('sequelize');
const cron = require('node-cron');

const app = express();

// Підключення до PostgreSQL
const sequelize = new Sequelize('postgresql://bonds_78vo_user:t8ClurBb872J2vVWZ9Zoihf5Vp11rFBW@dpg-d0f3q1pr0fns73cqh8f0-a.frankfurt-postgres.render.com/bonds_78vo', {
    logging: false,
    dialect: 'postgres',
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  });
  

// Модель для цін
const Price = sequelize.define('Price', {
  isin: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: Sequelize.NOW,
  },
  price: {
    type: DataTypes.FLOAT,
    allowNull: false,
  },
}, {
  tableName: 'prices',
  timestamps: false,
});

// Ініціалізація таблиці
(async () => {
  await sequelize.sync();
})();

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

    $('table tbody tr').each(async (_, row) => {
      const cells = $(row).find('td').map((_, td) => $(td).text().trim()).get();
      const isin = cells[1];
      const priceStr = cells[5];

      if (ISINS.includes(isin)) {
        const price = parseFloat(priceStr.replace(',', ''));
        if (!isNaN(price)) {
          await Price.create({ isin, price });
          console.log(`[✓] ${isin} => ${price}`);
        }
      }
    });
  } catch (err) {
    console.error('[!] Помилка парсингу:', err.message);
  }
}

// Збираємо щодня о 6:00
cron.schedule('0 6 * * *', scrapePrice);

// Головна сторінка
app.get('/', async (req, res) => {
  const allPrices = await Price.findAll({ order: [['timestamp', 'ASC']] });
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
      borderColor: '#' + Math.floor(Math.random() * 16777215).toString(16),
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
