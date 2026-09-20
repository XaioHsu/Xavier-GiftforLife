const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
// 重要：Render 會透過 process.env.PORT 指派連接埠
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 1. 正確綁定當前目錄為靜態資源目錄
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 2. 新增根目錄預設導向 index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- 後續的 SQLite、Multer、API 路由保持不變 ---

// 1. 初始化資料庫
const db = new sqlite3.Database('./gallery.db', (err) => {
  if (err) console.error('資料庫連線失敗:', err.message);
  else console.log('成功連接 SQLite 資料庫。');
});

db.run(`CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caption TEXT,
  image_url TEXT,
  category TEXT
)`);

// 2. 檔案上傳設定
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// 3. API：取得照片列表 (若無提供 category 則撈取全部)
app.get('/api/photos', (req, res) => {
  const category = req.query.category;
  const sql = category 
    ? 'SELECT * FROM photos WHERE category = ? ORDER BY id DESC'
    : 'SELECT * FROM photos ORDER BY id DESC';
  const params = category ? [category] : [];

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 4. API：批次上傳照片 (支援單張或最多 10 張)
app.post('/api/upload', upload.array('images', 10), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: '請至少選擇一張照片上傳' });
  }

  const { caption, category } = req.body;
  const targetCategory = category || 'moments';
  const stmt = db.prepare('INSERT INTO photos (caption, image_url, category) VALUES (?, ?, ?)');

  req.files.forEach((file) => {
    const imageUrl = `/uploads/${file.filename}`;
    stmt.run(caption || '', imageUrl, targetCategory);
  });

  stmt.finalize((err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: `成功上傳 ${req.files.length} 張相片！` });
  });
});

// 5. API：刪除相片 (同時清除檔案與資料庫)
app.delete('/api/photos/:id', (req, res) => {
  const photoId = req.params.id;

  // 先查詢出檔案路徑
  db.get('SELECT image_url FROM photos WHERE id = ?', [photoId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: '找不到該相片' });

    // 實體檔案路徑
    const filePath = path.join(__dirname, row.image_url);

    // 刪除資料庫資料
    db.run('DELETE FROM photos WHERE id = ?', [photoId], (deleteErr) => {
      if (deleteErr) return res.status(500).json({ error: deleteErr.message });

      // 同步刪除伺服器硬碟上的圖檔
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr && unlinkErr.code !== 'ENOENT') {
          console.error('檔案刪除失敗:', unlinkErr);
        }
      });

      res.json({ success: true, message: '相片已成功刪除' });
    });
  });
});

app.listen(PORT, () => {
  console.log(`後端伺服器已啟動: http://localhost:${PORT}`);
});