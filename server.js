// 1. FORZAR HORA ARGENTINA EN TODO EL PROCESO (Debe ir en la línea 1)
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
        
        // Al setear TZ, new Date() ya responde en hora Argentina
        const hoy = new Date();
        const formatFecha = (d) => d.toISOString().split('T')[0];

        if (filtro === 'hoy') {
            date_from = formatFecha(hoy);
            date_to = formatFecha(hoy);
        } else if (filtro === 'ayer') {
            const ayer = new Date();
            ayer.setDate(ayer.getDate() - 1);
            date_from = formatFecha(ayer);
            date_to = formatFecha(ayer);
        } else if (filtro === 'custom') {
            date_from = desde;
            date_to = hasta;
        } else {
            date_from = formatFecha(hoy);
            date_to = formatFecha(hoy);
        }

        // Consultamos con rango de tiempo completo para no perder nada
        const response = await axios.get('https://api.cucuru.com/app/v1/collection/collections', {
            params: { 
                date_from: `${date_from} 00:00:00`, 
                date_to: `${date_to} 23:59:59` 
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
                // Forzamos el formato local para la tabla
                fecha_limpia: new Date(c.date_time || c.created_at).toLocaleString('es-AR', {
                    timeZone: 'America/Argentina/Cordoba',
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', second: '2-digit'
                }),
                timestamp_raw: new Date(c.date_time || c.created_at).getTime(),
                comentario_local: matchComentario ? matchComentario.comentario : ""
            };
        });

        // FILTRO CAJERO: Normalización total
        let filtrados = respuestaFinal;
        if (idBuscado !== "todo" && idBuscado !== "") {
            filtrados = filtrados.filter(c => 
                String(c.customer_id || "").toLowerCase().trim() === idBuscado
            );
        }

        res.json({ 
            data: filtrados, 
            rangoConsultado: `${date_from} a ${date_to}` 
        });
    } catch (error) {
        console.error("ERROR API:", error.message);
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
