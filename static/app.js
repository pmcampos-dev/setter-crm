// --- State ---
let device = null;
let activeConnection = null;
let currentLeadId = null;
let currentFilter = 'todos';
let callTimer = null;
let callSeconds = 0;

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
    loadLeads();
    initTwilioDevice();
});

// --- Twilio Device ---
async function initTwilioDevice() {
    try {
        const res = await fetch('/api/token', { method: 'POST' });
        const data = await res.json();

        if (!data.token) {
            console.error('No token received:', data);
            updateDeviceStatus('error');
            return;
        }

        console.log('Token received, initializing device...');

        const options = { edge: 'ashburn' };

        // Codec preferences - only add if available in this SDK version
        if (Twilio.Device.Codec) {
            options.codecPreferences = [Twilio.Device.Codec.Opus, Twilio.Device.Codec.PCMU];
        }

        device = new Twilio.Device(data.token, options);

        device.on('registered', () => {
            console.log('Twilio device registered successfully');
            updateDeviceStatus('ready');
        });

        device.on('error', (error) => {
            console.error('Twilio device error:', error.message || error);
            updateDeviceStatus('error');
        });

        device.on('unregistered', () => {
            console.log('Twilio device unregistered');
            updateDeviceStatus('offline');
            setTimeout(initTwilioDevice, 5000);
        });

        device.on('tokenWillExpire', () => {
            console.log('Token expiring, refreshing...');
            fetch('/api/token', { method: 'POST' })
                .then(r => r.json())
                .then(d => device.updateToken(d.token))
                .catch(e => console.error('Token refresh failed:', e));
        });

        await device.register();
        console.log('device.register() called');

    } catch (err) {
        console.error('Failed to init Twilio:', err);
        updateDeviceStatus('error');
    }
}

function updateDeviceStatus(status) {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');

    switch (status) {
        case 'ready':
            dot.className = 'w-2 h-2 rounded-full bg-green-500';
            text.textContent = 'Listo para llamar';
            text.className = 'text-sm text-green-600';
            break;
        case 'error':
            dot.className = 'w-2 h-2 rounded-full bg-red-500';
            text.textContent = 'Error de conexión';
            text.className = 'text-sm text-red-600';
            break;
        case 'offline':
            dot.className = 'w-2 h-2 rounded-full bg-gray-400';
            text.textContent = 'Desconectado';
            text.className = 'text-sm text-gray-500';
            break;
        default:
            dot.className = 'w-2 h-2 rounded-full bg-yellow-400';
            text.textContent = 'Conectando...';
            text.className = 'text-sm text-yellow-600';
    }
}

// --- Calling ---
async function callLead(leadId, phone, name) {
    if (!device) {
        alert('El dispositivo de llamadas no está listo. Recarga la página.');
        return;
    }

    if (activeConnection) {
        alert('Ya hay una llamada activa. Cuelga primero.');
        return;
    }

    currentLeadId = leadId;
    document.getElementById('call-bar-name').textContent = `Llamando a ${name}...`;

    try {
        const call = await device.connect({ params: { To: phone } });
        activeConnection = call;
        showCallBar(true);
        startCallTimer();

        call.on('disconnect', () => {
            activeConnection = null;
            showCallBar(false);
            stopCallTimer();
        });

        call.on('cancel', () => {
            activeConnection = null;
            showCallBar(false);
            stopCallTimer();
        });
    } catch (err) {
        console.error('Call failed:', err);
        alert('Error al realizar la llamada: ' + err.message);
    }
}

function hangUp() {
    if (activeConnection) {
        activeConnection.disconnect();
    }
    device?.disconnectAll();
}

function showCallBar(show) {
    const bar = document.getElementById('call-bar');
    if (show) {
        bar.classList.remove('hidden');
    } else {
        bar.classList.add('hidden');
        // Log call when it ends
        if (currentLeadId && callSeconds > 0) {
            logCall(currentLeadId, callSeconds, 'completed');
        } else if (currentLeadId) {
            logCall(currentLeadId, 0, 'no-answer');
        }
    }
}

function startCallTimer() {
    callSeconds = 0;
    updateTimerDisplay();
    callTimer = setInterval(() => {
        callSeconds++;
        updateTimerDisplay();
    }, 1000);
}

function stopCallTimer() {
    if (callTimer) {
        clearInterval(callTimer);
        callTimer = null;
    }
}

function updateTimerDisplay() {
    const mins = Math.floor(callSeconds / 60).toString().padStart(2, '0');
    const secs = (callSeconds % 60).toString().padStart(2, '0');
    document.getElementById('call-bar-timer').textContent = `${mins}:${secs}`;
}

async function logCall(leadId, duration, status) {
    try {
        await fetch('/api/calls/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                lead_id: leadId,
                duration: duration,
                status: status,
            }),
        });
        // Refresh lead detail and list
        loadLeads();
        if (currentLeadId === leadId) {
            showLeadDetail(leadId);
        }
    } catch (err) {
        console.error('Error logging call:', err);
    }
}

// --- Leads ---
async function loadLeads() {
    try {
        const url = currentFilter && currentFilter !== 'todos'
            ? `/api/leads?status=${encodeURIComponent(currentFilter)}`
            : '/api/leads';
        const res = await fetch(url);
        const leads = await res.json();
        renderLeadsList(leads);
    } catch (err) {
        console.error('Error loading leads:', err);
    }
}

function renderLeadsList(leads) {
    const container = document.getElementById('leads-list');

    if (leads.length === 0) {
        container.innerHTML = '<p class="text-gray-400 text-sm text-center py-8">No hay leads</p>';
        return;
    }

    container.innerHTML = leads.map(lead => {
        const statusClass = 'status-' + (lead.status || 'nuevo').replace(' ', '-').replace('ó', 'o');
        const dateStr = lead.scheduled_at ? formatDate(lead.scheduled_at) : 'Sin cita';
        const isActive = lead.id === currentLeadId;

        return `
            <div onclick="showLeadDetail(${lead.id})"
                 class="bg-white rounded-lg border ${isActive ? 'border-blue-500 ring-2 ring-blue-100' : 'border-gray-200'} p-3 cursor-pointer hover:border-blue-300 transition-colors">
                <div class="flex items-start justify-between">
                    <div>
                        <p class="font-medium text-gray-900 text-sm">${escapeHtml(lead.name)}</p>
                        <p class="text-xs text-gray-500 mt-0.5">${escapeHtml(lead.phone || 'Sin teléfono')}</p>
                    </div>
                    <span class="px-2 py-0.5 rounded-full text-xs font-medium ${statusClass}">${escapeHtml(lead.status || 'nuevo')}</span>
                </div>
                <p class="text-xs text-gray-400 mt-1">${dateStr}</p>
            </div>
        `;
    }).join('');
}

async function showLeadDetail(leadId) {
    currentLeadId = leadId;
    loadLeads(); // Refresh to highlight active

    try {
        const res = await fetch(`/api/leads/${leadId}`);
        const lead = await res.json();
        renderLeadDetail(lead);
    } catch (err) {
        console.error('Error loading lead detail:', err);
    }
}

function renderLeadDetail(lead) {
    const container = document.getElementById('lead-detail');
    const statusClass = 'status-' + (lead.status || 'nuevo').replace(' ', '-').replace('ó', 'o');
    const dateStr = lead.scheduled_at ? formatDate(lead.scheduled_at) : 'Sin cita programada';

    const callsHtml = (lead.calls || []).map(call => {
        const dur = formatDuration(call.duration || 0);
        const date = formatDate(call.created_at);
        const icon = call.status === 'completed' ? '✓' : '✗';
        const color = call.status === 'completed' ? 'text-green-600' : 'text-red-500';
        return `<div class="flex items-center justify-between text-sm py-1.5 border-b border-gray-50">
            <span class="${color} font-medium">${icon} ${call.status === 'completed' ? 'Contestó' : 'No contestó'}</span>
            <span class="text-gray-400">${dur} - ${date}</span>
        </div>`;
    }).join('') || '<p class="text-gray-400 text-sm">Sin llamadas registradas</p>';

    const smsHtml = (lead.sms || []).map(sms => {
        const date = formatDate(sms.created_at);
        const icon = sms.direction === 'outbound' ? '→' : '←';
        return `<div class="bg-blue-50 rounded-lg p-2 text-sm">
            <div class="flex items-center gap-1 mb-1">
                <span class="text-blue-600 font-medium text-xs">${icon} ${sms.direction === 'outbound' ? 'Enviado' : 'Recibido'}</span>
                <span class="text-gray-400 text-xs">- ${date}</span>
            </div>
            <p class="text-gray-700">${escapeHtml(sms.body)}</p>
        </div>`;
    }).join('') || '';

    const notesHtml = (lead.notes || []).map(note => {
        return `<div class="bg-gray-50 rounded-lg p-2 text-sm">
            <p class="text-gray-700">${escapeHtml(note.text)}</p>
            <p class="text-xs text-gray-400 mt-1">${formatDate(note.created_at)}</p>
        </div>`;
    }).join('') || '';

    container.innerHTML = `
        <div class="flex items-start justify-between mb-6">
            <div>
                <h2 class="text-xl font-bold text-gray-900">${escapeHtml(lead.name)}</h2>
                <p class="text-gray-500 text-sm mt-1">${escapeHtml(lead.email || 'Sin email')}</p>
                <p class="text-gray-500 text-sm">${escapeHtml(lead.country || 'México')}</p>
            </div>
            <div class="flex items-center gap-2">
                <select onchange="updateLeadStatus(${lead.id}, this.value)" class="border border-gray-300 rounded-lg px-2 py-1 text-sm">
                    ${['nuevo', 'contactado', 'no contestó', 'interesado', 'cerrado', 'perdido'].map(s =>
                        `<option value="${s}" ${lead.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
                    ).join('')}
                </select>
            </div>
        </div>

        <!-- Contact Info -->
        <div class="bg-gray-50 rounded-lg p-4 mb-6">
            <div class="flex items-center justify-between">
                <div>
                    <p class="text-sm text-gray-500">Teléfono</p>
                    <p class="font-medium text-gray-900">${escapeHtml(lead.phone || 'Sin teléfono')}</p>
                </div>
                <div class="text-right">
                    <p class="text-sm text-gray-500">Cita agendada</p>
                    <p class="font-medium text-gray-900">${dateStr}</p>
                </div>
            </div>
            ${lead.phone ? `
                <button onclick="callLead(${lead.id}, '${escapeHtml(lead.phone)}', '${escapeHtml(lead.name)}')"
                        class="mt-3 w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path></svg>
                    Llamar
                </button>
            ` : ''}
        </div>

        <!-- Call History -->
        <div class="mb-6">
            <h3 class="text-sm font-semibold text-gray-700 mb-2">Historial de Llamadas</h3>
            ${callsHtml}
        </div>

        <!-- SMS -->
        <div class="mb-6">
            <h3 class="text-sm font-semibold text-gray-700 mb-2">SMS</h3>
            ${lead.phone ? `
                <div class="flex gap-2 mb-3">
                    <input id="sms-input" type="text" placeholder="Escribir mensaje..." class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                           onkeydown="if(event.key==='Enter')sendSms(${lead.id})">
                    <button onclick="sendSms(${lead.id})" class="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">Enviar</button>
                </div>
            ` : '<p class="text-gray-400 text-sm mb-3">Sin teléfono para enviar SMS</p>'}
            <div class="flex flex-col gap-2">
                ${smsHtml}
            </div>
        </div>

        <!-- Notes -->
        <div>
            <h3 class="text-sm font-semibold text-gray-700 mb-2">Notas</h3>
            <div class="flex gap-2 mb-3">
                <input id="note-input" type="text" placeholder="Agregar nota..." class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                       onkeydown="if(event.key==='Enter')addNote(${lead.id})">
                <button onclick="addNote(${lead.id})" class="bg-gray-900 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-800">Guardar</button>
            </div>
            <div class="flex flex-col gap-2">
                ${notesHtml}
            </div>
        </div>
    `;
}

async function updateLeadStatus(leadId, status) {
    try {
        await fetch(`/api/leads/${leadId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        });
        loadLeads();
    } catch (err) {
        console.error('Error updating status:', err);
    }
}

async function addNote(leadId) {
    const input = document.getElementById('note-input');
    const text = input.value.trim();
    if (!text) return;

    try {
        await fetch(`/api/leads/${leadId}/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        });
        input.value = '';
        showLeadDetail(leadId);
    } catch (err) {
        console.error('Error adding note:', err);
    }
}

// --- SMS ---
async function sendSms(leadId) {
    const input = document.getElementById('sms-input');
    const body = input.value.trim();
    if (!body) return;

    const btn = input.nextElementSibling;
    btn.disabled = true;
    btn.textContent = 'Enviando...';

    try {
        const res = await fetch(`/api/leads/${leadId}/sms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body }),
        });
        const data = await res.json();
        if (!res.ok) {
            alert('Error al enviar SMS: ' + (data.error || 'Error desconocido'));
        } else {
            input.value = '';
            showLeadDetail(leadId);
        }
    } catch (err) {
        console.error('Error sending SMS:', err);
        alert('Error al enviar SMS');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Enviar';
    }
}

// --- Filters ---
function filterLeads(status) {
    currentFilter = status;

    document.querySelectorAll('.filter-btn').forEach(btn => {
        if (btn.dataset.filter === status) {
            btn.className = 'filter-btn px-3 py-1 rounded-full text-xs font-medium bg-gray-900 text-white';
        } else {
            btn.className = 'filter-btn px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600';
        }
    });

    loadLeads();
}

// --- Add Lead Modal ---
function openAddLeadModal() {
    document.getElementById('add-lead-modal').classList.remove('hidden');
}

function closeAddLeadModal() {
    document.getElementById('add-lead-modal').classList.add('hidden');
}

async function submitNewLead(event) {
    event.preventDefault();

    const name = document.getElementById('new-lead-name').value.trim();
    const phone = document.getElementById('new-lead-phone').value.trim();
    const email = document.getElementById('new-lead-email').value.trim();
    const country = document.getElementById('new-lead-country').value;

    try {
        await fetch('/api/leads/manual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone, email, country }),
        });
        closeAddLeadModal();
        document.getElementById('new-lead-name').value = '';
        document.getElementById('new-lead-phone').value = '';
        document.getElementById('new-lead-email').value = '';
        loadLeads();
    } catch (err) {
        console.error('Error creating lead:', err);
    }
}

// --- Helpers ---
function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString('es-MX', {
            day: 'numeric', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch {
        return dateStr;
    }
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
