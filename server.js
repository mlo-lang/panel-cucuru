process.env.TZ = 'America/Argentina/Cordoba'; 
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

const HEADERS = {
    'X-Cucuru-Api-Key': process.env.CUCURU_API_KEY,
    'X-Cucuru-Collector-id': process.env.CUCURU_COLLECTOR_ID,
    'Content-Type': 'application/json'
};

app.get('/api/cobros/:cajeroId', async (req, res) => {
    try {
        const idBuscado = req.params.cajeroId.trim().toLowerCase();
        const { filtro, desde, hasta } = req.query;
        let date_from, date_to;
        const hoy = new Date();

        if (filtro === 'custom' && desde && hasta) {
            date_from = desde; date_to = hasta;
        } else {
            let ayer = new Date();
            ayer.setDate(hoy.getDate() - 1);
            date_from = ayer.toISOString().split('T')[0];
            let manana = new Date();
            manana.setDate(hoy.getDate() + 1);
            date_to = manana.toISOString().split('T')[0];
        }

        const response = await axios.get('https://api.cucuru.com/app/v1/collection/collections', {
            params: { date_from, date_to, limit: 100 },
            headers: HEADERS
        });

        const todos = response.data.collections || [];
        const filtrados = todos.filter(c => {
            if (idBuscado === "todo" || idBuscado === "") return true;
            return String(c.customer_id).toLowerCase().trim() === idBuscado;
        });

        const resComentarios = await pool.query("SELECT * FROM comentarios");
        const respuestaFinal = filtrados.map(c => {
            const match = resComentarios.rows.find(com => com.collection_id === String(c.collection_id));
            const ts = new Date(c.date_time || c.created_at).getTime();
            return { 
                ...c, 
                colsa_id: c.collection_trace_id || "---",
                cuit: c.customer_tax_id || "---", // Campo CUIT
                fecha_limpia: new Date(ts).toLocaleString('es-AR', {timeZone: 'America/Argentina/Cordoba'}),
                timestamp_raw: ts,
                comentario_local: match ? match.comentario : "" 
            };
        });

        res.json(respuestaFinal);
    } catch (error) {
        res.status(500).json({ error: "Error de servidor" });
    }
});

app.post('/api/comentar', async (req, res) => {
    const { collection_id, comentario } = req.body;
    await pool.query("INSERT INTO comentarios (collection_id, comentario) VALUES ($1, $2) ON CONFLICT (collection_id) DO UPDATE SET comentario = $2", [String(collection_id), comentario]);
    res.json({ status: "ok" });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(process.env.PORT || 3000);
