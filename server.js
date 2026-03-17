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
        const { filtro, desde, hasta, horaInicio } = req.query;
        let date_from, date_to;
        const hoy = new Date().toISOString().split('T')[0];

        if (filtro === 'dia' || !filtro) {
            date_from = hoy; date_to = hoy;
        } else if (filtro === 'semana') {
            let haceSiete = new Date();
            haceSiete.setDate(haceSiete.getDate() - 7);
            date_from = haceSiete.toISOString().split('T')[0];
            date_to = hoy;
        } else if (filtro === 'historico') {
            date_from = '2024-01-01'; date_to = '2026-12-31';
        } else if (filtro === 'custom') {
            date_from = desde; date_to = hasta;
        }

        const response = await axios.get('https://api.cucuru.com/app/v1/collection/collections', {
            params: { date_from, date_to },
            headers: HEADERS
        });

        let todos = response.data.collections || [];

        // Filtro de Turno por hora (ajustado para ser más permisivo con el formato)
        if (filtro === 'dia' && horaInicio && horaInicio !== "00:00") {
            todos = todos.filter(c => {
                const f = c.date_time || c.created_at;
                if (!f) return false;
                // Convertimos a hora local Argentina para comparar con el input del cajero
                const horaLocal = new Date(f).toLocaleTimeString('es-AR', {
                    timeZone: 'America/Argentina/Cordoba',
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit'
                });
                return horaLocal >= horaInicio;
            });
        }

        const filtrados = todos.filter(c => {
            if (idBuscado === "todo" || idBuscado === "") return true;
            return String(c.customer_id).toLowerCase() === idBuscado;
        });

        const resComentarios = await pool.query("SELECT * FROM comentarios");
        const respuestaFinal = filtrados.map(c => {
            const match = resComentarios.rows.find(com => com.collection_id === String(c.collection_id));
            return { ...c, comentario_local: match ? match.comentario : "" };
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
