import os
from twilio.jwt.access_token import AccessToken
from twilio.jwt.access_token.grants import VoiceGrant
from twilio.twiml.voice_response import VoiceResponse
from twilio.rest import Client


ACCOUNT_SID = os.environ.get('TWILIO_ACCOUNT_SID')
AUTH_TOKEN = os.environ.get('TWILIO_AUTH_TOKEN')
TWILIO_PHONE_NUMBER = os.environ.get('TWILIO_PHONE_NUMBER')
TWIML_APP_SID = os.environ.get('TWILIO_TWIML_APP_SID')
API_KEY_SID = os.environ.get('TWILIO_API_KEY_SID')
API_KEY_SECRET = os.environ.get('TWILIO_API_KEY_SECRET')

IDENTITY = 'setter'

_client = None

def get_twilio_client():
    global _client
    if _client is None:
        _client = Client(API_KEY_SID, API_KEY_SECRET, ACCOUNT_SID)
    return _client


def generate_access_token():
    token = AccessToken(
        ACCOUNT_SID,
        API_KEY_SID,
        API_KEY_SECRET,
        identity=IDENTITY,
    )
    voice_grant = VoiceGrant(
        outgoing_application_sid=TWIML_APP_SID,
        incoming_allow=True,
    )
    token.add_grant(voice_grant)
    return token.to_jwt()


def build_twiml_dial(to_number):
    response = VoiceResponse()
    dial = response.dial(caller_id=TWILIO_PHONE_NUMBER)
    dial.number(to_number)
    return str(response)


def send_sms(to_number, body):
    client = get_twilio_client()
    message = client.messages.create(
        body=body,
        from_=TWILIO_PHONE_NUMBER,
        to=to_number,
    )
    return message.sid, message.status
