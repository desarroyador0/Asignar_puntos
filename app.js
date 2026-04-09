// Configuracion de Frontend
// Endpoint de Netlify Edge Function (route definida en netlify.toml)
const EDGE_FUNCTION_URL = '/api/asignar-puntos';
const PESOS_POR_PUNTO = 1000;

// Estado de la app
const state = {
    cajero: null,
    html5QrCode: null,
    clienteActivo: null,
    historial: []
};

// Utilidades UI
const UI = {
    showScreen: (id) => {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(id).classList.add('active');
    },
    showSection: (id) => {
        document.querySelectorAll('.section-card').forEach(s => s.classList.remove('active'));
        document.getElementById(id).classList.add('active');
        if (id === 'section-scan') {
             document.getElementById('section-history').classList.add('active');
        } else {
             document.getElementById('section-history').classList.remove('active');
        }
    },
    toast: (msg, type = 'success') => {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icons = { success: '✅', error: '❌', warning: '⚠️' };
        toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> <span>${msg}</span>`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'toastLeave 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },
    toggleSpinner: (btnId, spinnerId, show) => {
        const btn = document.getElementById(btnId);
        const spinner = document.getElementById(spinnerId);
        const text = btn.querySelector('.btn-text');
        if (show) {
            btn.disabled = true;
            if(text) text.style.opacity = '0';
            spinner.classList.remove('hidden');
        } else {
            btn.disabled = false;
            if(text) text.style.opacity = '1';
            spinner.classList.add('hidden');
        }
    },
    updateHistory: () => {
        const list = document.getElementById('history-list');
        if (state.historial.length === 0) {
            list.innerHTML = '<li class="history-empty">Sin escaneos en esta sesión</li>';
            return;
        }
        list.innerHTML = '';
        [...state.historial].reverse().forEach(item => {
            const li = document.createElement('li');
            li.className = 'history-item';
            li.innerHTML = `
                <div class="history-info">
                    <strong>${item.telefono}</strong>
                    <span>$${item.monto}</span>
                </div>
                <div class="history-pts">+${item.puntos}</div>
            `;
            list.appendChild(li);
        });
    }
};

// Login local simulado (para la demo o puedes conectarlo a Auth de Supabase)
document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const user = document.getElementById('login-user').value.trim();
    const pass = document.getElementById('login-pass').value;
    
    // Validacion dummy
    if (!user || pass.length < 4) {
        UI.toast('Credenciales inválidas (mín. 4 caracteres)', 'error');
        return;
    }
    
    UI.toggleSpinner('btn-login', 'login-spinner', true);
    
    setTimeout(() => {
        state.cajero = user;
        document.getElementById('display-user').textContent = user;
        UI.showScreen('screen-main');
        UI.showSection('section-scan');
        initScanner();
        UI.toggleSpinner('btn-login', 'login-spinner', false);
    }, 800);
});

// Logout
document.getElementById('btn-logout').addEventListener('click', () => {
    if(state.html5QrCode && state.html5QrCode.isScanning) {
        state.html5QrCode.stop().catch(console.error);
    }
    state.cajero = null;
    state.historial = [];
    UI.updateHistory();
    document.getElementById('login-form').reset();
    UI.showScreen('screen-login');
});

// Lógica del Scanner
function initScanner() {
    if (!state.html5QrCode) {
        state.html5QrCode = new Html5Qrcode("reader");
    }
    const config = { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 };
    
    state.html5QrCode.start(
        { facingMode: "environment" },
        config,
        (decodedText, decodedResult) => {
            handleScanSuccess(decodedText);
        },
        (errorMessage) => {
            // ignorar errores constantes de parseo por cuadro
        }
    ).catch(err => {
        console.error("Error iniciando cámara", err);
        UI.toast('No se pudo iniciar la cámara automáticamente', 'error');
    });
}

function handleScanSuccess(text) {
    if(state.html5QrCode.isScanning) {
        state.html5QrCode.stop().then(() => {
            procesarCliente(text);
        }).catch(err => console.error("Error deteniendo el escáner", err));
    }
}

// Búsqueda Manual
document.getElementById('btn-search').addEventListener('click', () => {
    const tel = document.getElementById('manual-tel').value.trim();
    if (!tel) {
        UI.toast('Ingresá un teléfono válido', 'warning');
        return;
    }
    UI.toggleSpinner('btn-search', 'search-spinner', true);
    
    setTimeout(() => {
        UI.toggleSpinner('btn-search', 'search-spinner', false);
        document.getElementById('manual-tel').value = '';
        if(state.html5QrCode && state.html5QrCode.isScanning){
            state.html5QrCode.stop().catch(console.error);
        }
        procesarCliente(tel);
    }, 600);
});

// Procesar el cliente escaneado o buscado
function procesarCliente(telefono) {
    // Validacion basica de formato (asumiendo numerico o que tenga longitud)
    const telSanitizado = telefono.replace(/[^+0-9]/g, '');
    if (!telSanitizado) {
        UI.toast('Formato de QR / Teléfono inválido', 'error');
        initScanner();
        return;
    }

    state.clienteActivo = { telefono: telSanitizado };
    
    // UI Updates
    document.getElementById('c-name').textContent = "Cliente Encontrado";
    document.getElementById('c-tel').textContent = telSanitizado;
    document.getElementById('c-avatar').textContent = telSanitizado.charAt(telSanitizado.length-1) || "?";
    
    document.getElementById('monto').value = '';
    document.getElementById('pts-preview').textContent = '0';
    
    UI.showSection('section-action');
    setTimeout(() => document.getElementById('monto').focus(), 300);
}

// Cancelar asignacion
document.getElementById('btn-cancel').addEventListener('click', () => {
    state.clienteActivo = null;
    UI.showSection('section-scan');
    initScanner();
});

// Calculo de puntos en tiempo real
document.getElementById('monto').addEventListener('input', (e) => {
    const monto = parseFloat(e.target.value) || 0;
    const pts = Math.floor(monto / PESOS_POR_PUNTO);
    document.getElementById('pts-preview').textContent = pts.toLocaleString('es-AR');
});

// Confirmar y Enviar a Edge Function
document.getElementById('puntos-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.clienteActivo) return;

    const monto = parseFloat(document.getElementById('monto').value) || 0;
    const puntos = Math.floor(monto / PESOS_POR_PUNTO);

    if (monto <= 0) {
        UI.toast('Ingresa un monto válido', 'warning');
        return;
    }
    if (puntos < 1) {
        UI.toast(`El monto mínimo es $${PESOS_POR_PUNTO}`, 'warning');
        return;
    }

    UI.toggleSpinner('btn-confirm', 'confirm-spinner', true);

    const payload = {
        telefono: state.clienteActivo.telefono,
        monto: monto,
        puntos: puntos,
        cajero: state.cajero
    };

    try {
        const response = await fetch(EDGE_FUNCTION_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            // Intenta leer el body para obtener el error si es posible
            let errBody = {};
            try { errBody = await response.json(); } catch(e){}
            throw new Error(errBody.error || `Error HTTP: ${response.status}`);
        }

        const result = await response.json();
        
        if (result.error) {
            throw new Error(result.error);
        }

        // Éxito real
        UI.toast(`¡Sumaste ${puntos} puntos! Nuevo total: ${result.nuevoTotal}`, 'success');
        state.historial.push(payload);
        UI.updateHistory();
        
        // Volver a scan
        state.clienteActivo = null;
        UI.showSection('section-scan');
        initScanner();

    } catch (error) {
        console.error("Error asigando puntos:", error);
        UI.toast(error.message || 'Falló la conexión al servidor de puntos', 'error');
        
        // Para pruebas sin backend levantado, podemos falsear un éxito (Descomentar para demo offline)
        /*
        console.warn("[DEMO] Simulando éxito por falta de backend.");
        UI.toast(`[SIMULADO] Sumaste ${puntos} puntos`, 'success');
        state.historial.push(payload);
        UI.updateHistory();
        state.clienteActivo = null;
        UI.showSection('section-scan');
        initScanner();
        */

    } finally {
        UI.toggleSpinner('btn-confirm', 'confirm-spinner', false);
    }
});
