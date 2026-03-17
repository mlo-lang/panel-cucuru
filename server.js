const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// 1. CONFIGURACIÓN DE BASE DE DATOS
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Crear tabla si no existe
pool.query(`
    CREATE TABLE IF NOT EXISTS comentarios (
        collection_id TEXT PRIMARY KEY,
        comentario TEXT,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
`);

// 2. CREDENCIALES DE CUCURU
const HEADERS = {
    'X-Cucuru-Api-Key': process.env.CUCURU_API_KEY,
    'X-Cucuru-Collector-id': process.env.CUCURU_COLLECTOR_ID,
    'Content-Type': 'application/json'
};

// 3. RUTA PARA EL PANEL DEL CAJERO (FILTRO POR CUSTOMER_ID)
app.get('/api/cobros/:cajeroId', async (req, res) => {
    try {
        const idBuscado = req.params.cajeroId.trim().toLowerCase();
        const { filtro, desde, hasta } = req.query; // Recibimos los nuevos parámetros
        
        let date_from, date_to;
        const hoy = new Date();

        // LÓGICA DE FECHAS
        if (filtro === 'dia') {
            date_from = hoy.toISOString().split('T')[0];
            date_to = date_from;
        } else if (filtro === 'semana') {
            const semanaPasada = new Date();
            semanaPasada.setDate(hoy.getDate() - 7);
            date_from = semanaPasada.toISOString().split('T')[0];
            date_to = hoy.toISOString().split('T')[0];
        } else if (filtro === 'historico') {
            date_from = '2024-01-01'; // Un inicio bien atrás
            date_to = hoy.toISOString().split('T')[0];
        } else if (filtro === 'custom') {
            date_from = desde;
            date_to = hasta;
        }

        console.log(`Consultando Cucuru: ${filtro} (${date_from} al ${date_to}) para ${idBuscado}`);

        const response = await axios.get('https://api.cucuru.com/app/v1/collection/collections', {
            params: { date_from, date_to },
            headers: HEADERS
        });

        const todosLosCobros = response.data.collections || [];
        
        // Filtramos por ID (si no es "todo")
        const filtrados = todosLosCobros.filter(c => {
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
        console.error("Error:", error.message);
        res.status(500).json({ error: "Error de servidor" });
    }
});
// 4. GUARDAR COMENTARIOS
app.post('/api/comentar', async (req, res) => {
    const { collection_id, comentario } = req.body;
    try {
        await pool.query(
            "INSERT INTO comentarios (collection_id, comentario) VALUES ($1, $2) ON CONFLICT (collection_id) DO UPDATE SET comentario = $2",
            [String(collection_id), comentario]
        );
        res.json({ status: "ok" });
    } catch (err) {
        res.status(500).send(err);
    }
});

// 5. EL WEBHOOK QUE RECIBE LAS NOTIFICACIONES
app.post('/collection_received', (req, res) => {
    console.log("NOTIFICACIÓN RECIBIDA:", JSON.stringify(req.body));
    res.status(200).send("OK");
});

// Servir la web
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// 6. ARRANQUE Y AUTO-REGISTRO
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Servidor iniciado en puerto ${PORT}`);
    
    // Intenta registrarse solo al iniciar
    try {
        const miUrl = "https://mi-panel-cucuru.onrender.com"; // CAMBIA ESTO POR TU URL DE RENDER
        await axios.post('https://api.cucuru.com/app/v1/collection/webhooks/endpoint', 
            { url: miUrl }, 
            { headers: HEADERS }
        );
        console.log("✅ Webhook registrado en Cucuru correctamente");
    } catch (e) {
        console.log("⚠️ Nota sobre Webhook:", e.response?.data?.message || "Ya estaba registrado o requiere ajuste manual.");
    }
});
