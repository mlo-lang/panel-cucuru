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
        
        const ahoraArg = new Date().toLocaleString("en-US", {timeZone: "America/Argentina/Cordoba"});
        const hoy = new Date(ahoraArg).toISOString().split('T')[0];

        if (filtro === 'dia' || !filtro) {
            date_from = hoy; date_to = hoy;
        } else if (filtro === 'semana') {
            let haceSiete = new Date(ahoraArg);
            haceSiete.setDate(haceSiete.getDate() - 7);
            date_from = haceSiete.toISOString().split('T')[0];
            date_to = hoy;
        } else {
            date_from = desde || '2024-01-01';
            date_to = hasta || hoy;
        }

        const response = await axios.get('https://api.cucuru.com/app/v1/collection/collections', {
            params: { date_from, date_to },
            headers: HEADERS
        });

        const resComentarios = await pool.query("SELECT * FROM comentarios");
        let todos = response.data.collections || [];

        const respuestaFinal = todos.map(c => {
            // Extraer ID Colsa del JSON transfer_data si existe
            let colsaId = "---";
            if (c.transfer_data) {
                try {
                    const dataObj = typeof c.transfer_data === 'string' ? JSON.parse(c.transfer_data) : c.transfer_data;
                    colsaId = dataObj.data?.id || "---";
                } catch(e) { colsaId = "---"; }
            }

            const matchComentario = resComentarios.rows.find(com => com.collection_id === String(c.collection_id));

            return {
                ...c,
                colsa_id: colsaId,
                fecha_limpia: new Date(c.date_time || c.created_at).toLocaleString('es-AR', {timeZone: 'America/Argentina/Cordoba'}),
                timestamp_raw: new Date(c.date_time || c.created_at).getTime(),
                comentario_local: matchComentario ? matchComentario.comentario : ""
            };
        });

        // Filtrado solo por Cajero
        let filtrados = respuestaFinal;
        if (idBuscado !== "todo" && idBuscado !== "") {
            filtrados = filtrados.filter(c => String(c.customer_id).toLowerCase() === idBuscado);
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
