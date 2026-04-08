import os
import json
from flask import Flask, request, jsonify, render_template, Response
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

import models
import twilio_service

app = Flask(__name__)

models.init_db()


# --- Pages ---

@app.route('/')
def index():
    return render_template('index.html')


# --- Calendly Webhook ---

@app.route('/webhooks/calendly', methods=['POST'])
def calendly_webhook():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'no data'}), 400

    event = data.get('event', '')

    if event == 'invitee.created':
        payload = data.get('payload', {})
        name = payload.get('name', 'Sin nombre')
        email = payload.get('email', '')
        phone = ''

        questions = payload.get('questions_and_answers', [])
        for q in questions:
            answer = q.get('answer', '')
            question_text = q.get('question', '').lower()
            if 'teléfono' in question_text or 'phone' in question_text or 'celular' in question_text or 'whatsapp' in question_text:
                phone = answer
                break

        if not phone:
            text_fields = payload.get('text_reminder_number', '')
            if text_fields:
                phone = text_fields

        scheduled_at = payload.get('scheduled_event', {}).get('start_time', '')
        event_uri = payload.get('uri', '')

        lead_id = models.create_lead(
            name=name,
            email=email,
            phone=phone,
            scheduled_at=scheduled_at,
            calendly_event_uri=event_uri,
        )

        if lead_id:
            return jsonify({'status': 'created', 'lead_id': lead_id}), 201
        else:
            return jsonify({'status': 'duplicate'}), 200

    return jsonify({'status': 'ignored'}), 200


# --- API: Leads ---

@app.route('/api/leads', methods=['GET'])
def api_leads():
    status = request.args.get('status', None)
    leads = models.get_leads(status=status)
    return jsonify(leads)


@app.route('/api/leads/<int:lead_id>', methods=['GET'])
def api_lead(lead_id):
    lead = models.get_lead(lead_id)
    if not lead:
        return jsonify({'error': 'not found'}), 404
    lead['calls'] = models.get_calls_for_lead(lead_id)
    lead['notes'] = models.get_notes_for_lead(lead_id)
    return jsonify(lead)


@app.route('/api/leads/<int:lead_id>/status', methods=['PUT'])
def api_update_lead_status(lead_id):
    data = request.get_json()
    status = data.get('status')
    if not status:
        return jsonify({'error': 'status required'}), 400
    models.update_lead_status(lead_id, status)
    return jsonify({'status': 'updated'})


@app.route('/api/leads/manual', methods=['POST'])
def api_create_lead_manual():
    data = request.get_json()
    name = data.get('name', '').strip()
    phone = data.get('phone', '').strip()
    email = data.get('email', '').strip()
    country = data.get('country', 'México').strip()

    if not name or not phone:
        return jsonify({'error': 'name and phone required'}), 400

    lead_id = models.create_lead(
        name=name,
        email=email,
        phone=phone,
        scheduled_at='',
        country=country,
    )
    return jsonify({'status': 'created', 'lead_id': lead_id}), 201


# --- API: Twilio Token ---

@app.route('/api/token', methods=['POST'])
def api_token():
    token = twilio_service.generate_access_token()
    return jsonify({'token': token})


# --- API: TwiML Voice Webhook ---

@app.route('/api/voice', methods=['POST'])
def api_voice():
    to_number = request.form.get('To', '')
    if not to_number:
        to_number = request.values.get('To', '')

    if to_number:
        twiml = twilio_service.build_twiml_dial(to_number)
    else:
        from twilio.twiml.voice_response import VoiceResponse
        response = VoiceResponse()
        response.say('No se proporcionó un número para marcar.', language='es-MX')
        twiml = str(response)

    return Response(twiml, mimetype='text/xml')


# --- API: Call Logging ---

@app.route('/api/calls/log', methods=['POST'])
def api_log_call():
    data = request.get_json()
    lead_id = data.get('lead_id')
    twilio_call_sid = data.get('call_sid', '')
    duration = data.get('duration', 0)
    status = data.get('status', 'completed')

    if not lead_id:
        return jsonify({'error': 'lead_id required'}), 400

    call_id = models.create_call(lead_id, twilio_call_sid)
    models.update_call(call_id, duration=duration, status=status)

    if status == 'completed' and duration > 0:
        models.update_lead_status(lead_id, 'contactado')
    elif status == 'no-answer':
        models.update_lead_status(lead_id, 'no contestó')

    return jsonify({'status': 'logged', 'call_id': call_id})


@app.route('/api/calls/<int:lead_id>', methods=['GET'])
def api_calls(lead_id):
    calls = models.get_calls_for_lead(lead_id)
    return jsonify(calls)


# --- API: Notes ---

@app.route('/api/leads/<int:lead_id>/notes', methods=['POST'])
def api_create_note(lead_id):
    data = request.get_json()
    text = data.get('text', '').strip()
    if not text:
        return jsonify({'error': 'text required'}), 400
    models.create_note(lead_id, text)
    return jsonify({'status': 'created'})


@app.route('/api/leads/<int:lead_id>/notes', methods=['GET'])
def api_get_notes(lead_id):
    notes = models.get_notes_for_lead(lead_id)
    return jsonify(notes)


# --- Twilio Status Callback ---

@app.route('/api/call-status', methods=['POST'])
def api_call_status():
    call_sid = request.form.get('CallSid', '')
    call_status = request.form.get('CallStatus', '')
    duration = request.form.get('CallDuration', 0)

    try:
        duration = int(duration)
    except (ValueError, TypeError):
        duration = 0

    return jsonify({'status': 'received'})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=True, host='0.0.0.0', port=port)
