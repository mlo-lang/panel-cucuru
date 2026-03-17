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
        const ahoraArg = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Argentina/Cordoba"}));
        const formatStr = (d) => d.toISOString().split('T')[0];

        if (filtro === 'hoy') {
            date_from = formatStr(ahoraArg); date_to = formatStr(ahoraArg);
        } else if (filtro === 'ayer') {
            const ayer = new Date(ahoraArg); ayer.setDate(ayer.getDate() - 1);
            date_from = formatStr(ayer); date_to = formatStr(ayer);
        } else if (filtro === 'custom') {
            date_from = desde; date_to = hasta;
        } else {
            date_from = formatStr(ahoraArg); date_to = formatStr(ahoraArg);
        }

        const response = await axios.get('https://api.cucuru.com/app/v1/collection/collections', {
            params: { date_from, date_to },
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

        // FILTRO DE CAJERO CORREGIDO (Normaliza ambos lados para que 'cajero_marcos' aparezca siempre)
        let filtrados = respuestaFinal;
        if (idBuscado !== "todo" && idBuscado !== "") {
            filtrados = filtrados.filter(c => {
                const idCobro = String(c.customer_id || "").trim().toLowerCase();
                return idCobro === idBuscado;
            });
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
