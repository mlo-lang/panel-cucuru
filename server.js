const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Crear tabla
pool.query(`CREATE TABLE IF NOT EXISTS comentarios (collection_id TEXT PRIMARY KEY, comentario TEXT, fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);

const HEADERS = {
    'X-Cucuru-Api-Key': process.env.CUCURU_API_KEY,
    'X-Cucuru-Collector-id': process.env.CUCURU_COLLECTOR_ID
};

// --- RUTAS DEL PANEL ---
app.get('/api/cobros/:cajeroId', async (req, res) => {
    try {
        const hoy = new Date().toISOString().split('T')[0];
        const response = await axios.get('https://api.cucuru.com/app/v1/collection/collections', {
            params: { date_from: hoy, customer_id: req.params.cajeroId },
            headers: HEADERS
        });
        const resComentarios = await pool.query("SELECT * FROM comentarios");
        const cobrosCombinados = response.data.collections.map(c => {
            const match = resComentarios.rows.find(com => com.collection_id === c.collection_id);
            return { ...c, comentario_local: match ? match.comentario : "" };
        });
        res.json(cobrosCombinados);
    } catch (error) { res.status(500).json({ error: "Error" }); }
});

app.post('/api/comentar', async (req, res) => {
    const { collection_id, comentario } = req.body;
    await pool.query("INSERT INTO comentarios (collection_id, comentario) VALUES ($1, $2) ON CONFLICT (collection_id) DO UPDATE SET comentario = $2", [collection_id, comentario]);
    res.json({ status: "ok" });
});

// --- EL WEBHOOK (LO QUE CUCURU VALIDA) ---
app.post('/webhooks/collection_received', (req, res) => {
    console.log("¡Webhook recibido con éxito!", req.body);
    res.status(200).send("OK");
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// --- FUNCIÓN DE AUTO-CONFIGURACIÓN (LA "OTRA MANERA") ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Servidor en puerto ${PORT}`);
    
    // Intentar registrar el webhook automáticamente al arrancar
    try {
        console.log("Intentando registrar Webhook en Cucuru...");
        const urlApp = "https://mi-panel-cucuru.onrender.com/webhooks"; // CAMBIA ESTO POR TU URL REAL
        
        await axios.post('https://api.cucuru.com/app/v1/collection/webhooks/endpoint', 
            { url: urlApp }, 
            { headers: HEADERS }
        );
        console.log("✅ WEBHOOK REGISTRADO AUTOMÁTICAMENTE");
    } catch (error) {
        console.log("❌ Error en auto-registro:", error.response ? error.response.data : error.message);
    }
});
