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

        // REPLICANDO TU LÓGICA GANADORA DE FECHAS
        if (filtro === 'dia' || !filtro || filtro === 'hoy') {
            let ayer = new Date();
            ayer.setDate(hoy.getDate() - 1);
            date_from = ayer.toISOString().split('T')[0];
            
            let manana = new Date();
            manana.setDate(hoy.getDate() + 1);
            date_to = manana.toISOString().split('T')[0];
        } else if (filtro === 'ayer') {
            let antesDeAyer = new Date();
            antesDeAyer.setDate(hoy.getDate() - 2);
            date_from = antesDeAyer.toISOString().split('T')[0];
            date_to = hoy.toISOString().split('T')[0];
        } else if (filtro === 'custom') {
            date_from = desde;
            date_to = hasta;
        }

        const response = await axios.get('https://api.cucuru.com/app/v1/collection/collections', {
            params: { date_from, date_to, limit: 100 },
            headers: HEADERS
        });

        const todos = response.data.collections || [];

        // Filtro de Cajero normalizado
        const filtrados = todos.filter(c => {
            if (idBuscado === "todo" || idBuscado === "") return true;
            return String(c.customer_id).toLowerCase().trim() === idBuscado;
        });

        const resComentarios = await pool.query("SELECT * FROM comentarios");
        
        const respuestaFinal = filtrados.map(c => {
            const match = resComentarios.rows.find(com => com.collection_id === String(c.collection_id));
            return { 
                ...c, 
                colsa_id: c.collection_trace_id || "---",
                fecha_limpia: new Date(c.date_time || c.created_at).toLocaleString('es-AR', {timeZone: 'America/Argentina/Cordoba'}),
                timestamp_raw: new Date(c.date_time || c.created_at).getTime(),
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
    await pool.query(
        "INSERT INTO comentarios (collection_id, comentario) VALUES ($1, $2) ON CONFLICT (collection_id) DO UPDATE SET comentario = $2",
        [String(collection_id), comentario]
    );
    res.json({ status: "ok" });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(process.env.PORT || 3000);
