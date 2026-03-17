const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// CONFIGURACIÓN DE BASE DE DATOS
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// CREDENCIALES DE CUCURU
const HEADERS = {
    'X-Cucuru-Api-Key': process.env.CUCURU_API_KEY,
    'X-Cucuru-Collector-id': process.env.CUCURU_COLLECTOR_ID,
    'Content-Type': 'application/json'
};

// RUTA PARA CONSULTAR COBROS
app.get('/api/cobros/:cajeroId', async (req, res) => {
    try {
        const idBuscado = req.params.cajeroId.trim().toLowerCase();
        const { filtro, desde, hasta } = req.query;
        let date_from, date_to;
        const hoy = new Date();

        // Lógica de fechas según el filtro
        if (filtro === 'dia' || !filtro) {
            date_from = hoy.toISOString().split('T')[0];
            date_to = date_from;
        } else if (filtro === 'semana') {
            let haceUnaSemana = new Date();
            haceUnaSemana.setDate(hoy.getDate() - 7);
            date_from = haceUnaSemana.toISOString().split('T')[0];
            date_to = hoy.toISOString().split('T')[0];
        } else if (filtro === 'historico') {
            date_from = '2024-01-01';
            date_to = hoy.toISOString().split('T')[0];
        } else if (filtro === 'custom') {
            date_from = desde;
            date_to = hasta;
        }

        const response = await axios.get('https://api.cucuru.com/app/v1/collection/collections', {
            params: { date_from, date_to },
            headers: HEADERS,
            timeout: 8000
        });

        const todos = response.data.collections || [];

        // Filtrado por Customer ID
        const filtrados = todos.filter(c => {
            if (idBuscado === "todo" || idBuscado === "") return true;
            return String(c.customer_id).toLowerCase() === idBuscado;
        });

        // Combinar con comentarios de la DB
        const resComentarios = await pool.query("SELECT * FROM comentarios");
        const respuestaFinal = filtrados.map(c => {
            const match = resComentarios.rows.find(com => com.collection_id === String(c.collection_id));
            return { 
                ...c, 
                comentario_local: match ? match.comentario : "" 
            };
        });

        res.json(respuestaFinal);
    } catch (error) {
        console.error("Error en servidor:", error.message);
        res.status(500).json({ error: "Error de servidor" });
    }
});

// GUARDAR COMENTARIOS
app.post('/api/comentar', async (req, res) => {
    try {
        const { collection_id, comentario } = req.body;
        await pool.query(
            "INSERT INTO comentarios (collection_id, comentario) VALUES ($1, $2) ON CONFLICT (collection_id) DO UPDATE SET comentario = $2",
            [String(collection_id), comentario]
        );
        res.json({ status: "ok" });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
