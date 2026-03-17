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
        
        // Volvemos a la lógica de fechas simple que funcionaba al principio
        let date_from, date_to;
        const hoy = new Date().toISOString().split('T')[0];

        if (filtro === 'hoy') {
            date_from = hoy; date_to = hoy;
        } else if (filtro === 'ayer') {
            const d = new Date(); d.setDate(d.getDate() - 1);
            date_from = d.toISOString().split('T')[0];
            date_to = d.toISOString().split('T')[0];
        } else if (filtro === 'custom') {
            date_from = desde; date_to = hasta;
        } else {
            date_from = hoy; date_to = hoy;
        }

        const response = await axios.get('https://api.cucuru.com/app/v1/collection/collections', {
            params: { 
                date_from, 
                date_to,
                limit: 100 // AGREGADO: Para que no se corte en 15 cobros
            },
            headers: HEADERS
        });

        const resComentarios = await pool.query("SELECT * FROM comentarios");
        let todos = response.data.collections || [];

        const respuestaFinal = todos.map(c => {
            const matchComentario = resComentarios.rows.find(com => com.collection_id === String(c.collection_id));
            return {
                ...c,
                colsa_id: c.collection_trace_id || "---",
                fecha_limpia: new Date(c.date_time || c.created_at).toLocaleString('es-AR', {timeZone: 'America/Argentina/Cordoba'}),
                timestamp_raw: new Date(c.date_time || c.created_at).getTime(),
                comentario_local: matchComentario ? matchComentario.comentario : ""
            };
        });

        let filtrados = respuestaFinal;
        if (idBuscado !== "todo" && idBuscado !== "") {
            filtrados = filtrados.filter(c => String(c.customer_id || "").toLowerCase().trim() === idBuscado);
        }

        res.json(filtrados);
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
