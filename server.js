const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Conexión a Base de Datos de Render
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Crear tabla de comentarios si no existe
pool.query(`
    CREATE TABLE IF NOT EXISTS comentarios (
        collection_id TEXT PRIMARY KEY,
        comentario TEXT,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
`);

const HEADERS = {
    'X-Cucuru-Api-Key': process.env.CUCURU_API_KEY,
    'X-Cucuru-Collector-id': process.env.CUCURU_COLLECTOR_ID
};

// 1. Endpoint para que el cajero vea sus cobros
app.get('/api/cobros/:cajeroId', async (req, res) => {
    try {
        const hoy = new Date().toISOString().split('T')[0];
        const response = await axios.get('https://api.cucuru.com/app/v1/collection/collections', {
            params: { date_from: hoy, customer_id: req.params.cajeroId },
            headers: HEADERS
        });

        const resComentarios = await pool.query("SELECT * FROM comentarios");
        const listaComentarios = resComentarios.rows;

        const cobrosCombinados = response.data.collections.map(c => {
            const match = listaComentarios.find(com => com.collection_id === c.collection_id);
            return { ...c, comentario_local: match ? match.comentario : "" };
        });

        res.json(cobrosCombinados);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error en servidor" });
    }
});

// 2. Guardar comentario del cajero
app.post('/api/comentar', async (req, res) => {
    const { collection_id, comentario } = req.body;
    try {
        await pool.query(
            "INSERT INTO comentarios (collection_id, comentario) VALUES ($1, $2) ON CONFLICT (collection_id) DO UPDATE SET comentario = $2",
            [collection_id, comentario]
        );
        res.json({ status: "ok" });
    } catch (err) {
        res.status(500).send(err);
    }
});

// 3. WEBHOOK CRÍTICO: Esta ruta es la que Cucuru valida (IMPORTANTE)
app.post('/webhook-cucuru/collection_received', (req, res) => {
    console.log("Notificación recibida de Cucuru:", req.body);
    // Respondemos 200 OK para que Cucuru acepte el webhook
    res.status(200).send("OK");
});

// Servir la pantalla principal
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
