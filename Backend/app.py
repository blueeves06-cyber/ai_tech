import os
import requests
import google.generativeai as genai
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_FRONTEND_DIR = os.path.normpath(os.path.join(_BASE_DIR, "..", "frontend"))

_gemini_model = None


def env_gemini_key():
    """Google AI Studio: GEMINI_API_KEY. Beberapa setup memakai GOOGLE_API_KEY."""
    return (
        os.environ.get("GEMINI_API_KEY")
        or os.environ.get("GOOGLE_API_KEY")
        or ""
    ).strip()


def env_weather_key():
    return (os.environ.get("WEATHER_API_KEY") or os.environ.get("WEATHERAPI_KEY") or "").strip()


def env_gemini_model_name():
    return (os.environ.get("GEMINI_MODEL") or "gemini-1.5-flash").strip()


def get_gemini_model():
    """Sama konsepnya dengan genai.configure + GenerativeModel, tapi dijalankan saat pertama kali analisis (hemat cold start)."""
    global _gemini_model
    if _gemini_model is None:
        key = env_gemini_key()
        if not key:
            raise RuntimeError(
                "API key Gemini tidak ada. Di Vercel: Settings → Environment Variables → "
                "tambah GEMINI_API_KEY (atau GOOGLE_API_KEY), centang Production + Preview, lalu redeploy."
            )
        genai.configure(api_key=key)
        _gemini_model = genai.GenerativeModel(env_gemini_model_name())
    return _gemini_model

def get_weather_context(location):
    """Mengambil data cuaca real-time untuk memperkuat reasoning AI"""
    if not env_weather_key():
        return None
    base_url = "http://api.weatherapi.com/v1/current.json"
    params = {
        "key": env_weather_key(),
        "q": location,
        "aqi": "no"
    }
    try:
        response = requests.get(base_url, params=params, timeout=10)
        if response.status_code == 200:
            data = response.json()
            return {
                "temp": data['current']['temp_c'],
                "humidity": data['current']['humidity'],
                "condition": data['current']['condition']['text'],
                "city": data['location']['name']
            }
    except Exception as e:
        print(f"Weather API Error: {e}")
    return None


def get_weather_forecast_bundle(location):
    """Cuaca saat ini + perkiraan besok untuk dasbor frontend."""
    if not env_weather_key():
        return None
    out = {"current": None, "forecast_tomorrow": None}
    try:
        cur = requests.get(
            "http://api.weatherapi.com/v1/current.json",
            params={"key": env_weather_key(), "q": location, "aqi": "no"},
            timeout=10,
        )
        if cur.status_code == 200:
            d = cur.json()
            out["current"] = {
                "temp_c": d["current"]["temp_c"],
                "humidity": d["current"]["humidity"],
                "condition_text": d["current"]["condition"]["text"],
                "city": d["location"]["name"],
                "region": d["location"].get("region", ""),
            }
        fc = requests.get(
            "http://api.weatherapi.com/v1/forecast.json",
            params={"key": env_weather_key(), "q": location, "days": 2, "aqi": "no", "alerts": "no"},
            timeout=10,
        )
        if fc.status_code == 200:
            fd = fc.json()
            days = fd.get("forecast", {}).get("forecastday", [])
            if len(days) > 1:
                t = days[1]["day"]
                out["forecast_tomorrow"] = {
                    "condition_text": t["condition"]["text"],
                    "maxtemp_c": t.get("maxtemp_c"),
                    "mintemp_c": t.get("mintemp_c"),
                    "daily_chance_of_rain": t.get("daily_chance_of_rain"),
                }
    except Exception as e:
        print(f"Weather bundle error: {e}")
        return None
    if not out["current"]:
        return None
    adv_title = "Kondisi cuaca lahan"
    adv_body = f"Sekarang {out['current']['condition_text']}, kelembapan {out['current']['humidity']}%."
    tom = out.get("forecast_tomorrow") or {}
    rain = tom.get("daily_chance_of_rain")
    if rain is not None and rain >= 50:
        adv_title = "Peringatan hujan"
        adv_body = (
            f"Peluang hujan besok sekitar {rain}%. "
            "Pertimbangkan penjadwalan penyemprotan dan drainase."
        )
    out["advisory"] = {"title": adv_title, "body": adv_body}
    return out

@app.route('/analyze', methods=['POST'])
def analyze_onion():
    try:
        if not env_gemini_key():
            return (
                jsonify(
                    {
                        "error": "GEMINI_API_KEY / GOOGLE_API_KEY belum di-set di server (Vercel → Environment Variables → Production + Preview → Redeploy)."
                    }
                ),
                503,
            )

        # 1. Ambil Input
        if 'image' not in request.files:
            return jsonify({"error": "Silakan unggah foto daun bawang"}), 400
            
        img_file = request.files['image']
        user_location = request.form.get('location', 'Brebes, Central Java')

        # 2. Ambil Konteks Cuaca Lokal
        weather = get_weather_context(user_location)
        weather_str = "Data tidak tersedia"
        if weather:
            weather_str = f"Suhu: {weather['temp']}C, Kelembapan: {weather['humidity']}%, Kondisi: {weather['condition']}"

        # 3. Siapkan Prompt
        # Gunakan format yang lebih ketat agar Gemini tidak memberikan teks tambahan
        prompt = f"""
        Role: Anda adalah AgriMind AI Agent, pakar agronomi bawang merah di {user_location}.
        Konteks Lingkungan Saat Ini: {weather_str}.
        
        Tugas:
        1. Analisis foto daun bawang secara visual.
        2. Lakukan reasoning hubungan gejala visual dengan cuaca.
        3. Berikan diagnosa dan langkah konkret.
        4. Isi objek "dashboard" untuk UI: gunakan perkiraan agronomi yang wajar dari foto + cuaca; jika tidak pasti gunakan null atau string "—" dan array kosong [].

        Berikan respons HANYA dalam format JSON:
        {{
            "health_index": 0-100,
            "primary_diagnosis": "string",
            "risk_assessment": "string",
            "environmental_inference": {{
                "soil_moisture": "string",
                "ph_level": "string"
            }},
            "action_plan": ["string"],
            "weather_context": {{
                "location": "{user_location}",
                "temp": "{weather['temp'] if weather else 'N/A'}",
                "humidity": "{weather['humidity'] if weather else 'N/A'}"
            }},
            "dashboard": {{
                "advisory_title": "string singkat peringatan agronomi/cuaca",
                "advisory_body": "string 1-2 kalimat",
                "env_note": "string penjelasan singkat inferensi lingkungan",
                "field_blocks": [
                    {{"name": "string", "variety": "string", "area_ha": 0.0, "yield_ton": 0.0, "growth_status": "string"}}
                ],
                "harvest_summary": {{
                    "total_yield_ton": 0.0,
                    "total_area_ha": 0.0,
                    "accuracy_note": "string singkat"
                }},
                "market_snapshot": {{
                    "location_label": "string",
                    "price_per_kg_idr": 0,
                    "change_note": "string"
                }},
                "schedule": {{
                    "focus_block": "string",
                    "plant_age_days": 0,
                    "cycle_total_days": 60,
                    "harvest_target_iso": "YYYY-MM-DD",
                    "days_to_harvest": 0,
                    "irrigation_suggestion": "string",
                    "tomorrow_condition": "string",
                    "fertilizer_hint": "string"
                }},
                "daily_tasks": [
                    {{"title": "string", "detail": "string", "priority": "kritis|rutin|selesai", "done": false}}
                ]
            }}
        }}
        """

        # 4. Proses Gambar dan Kirim ke Gemini
        img_data = img_file.read()
        image_part = {
            "mime_type": img_file.content_type,
            "data": img_data
        }

        response = get_gemini_model().generate_content([prompt, image_part])
        
        # Bersihkan response teks dari markdown block
        clean_json = response.text.replace('```json', '').replace('```', '').strip()

        import json
        result = json.loads(clean_json)

        if weather:
            result["weather_context"] = {
                "location": user_location,
                "temp": weather["temp"],
                "humidity": weather["humidity"],
                "condition": weather["condition"],
            }

        if "dashboard" not in result or not isinstance(result.get("dashboard"), dict):
            result["dashboard"] = {}

        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/weather", methods=["GET"])
def weather_endpoint():
    loc = request.args.get("location", "Brebes, Indonesia")
    bundle = get_weather_forecast_bundle(loc)
    if not bundle:
        return jsonify({"error": "Cuaca tidak tersedia (cek WEATHER_API_KEY atau lokasi)."}), 503
    return jsonify(bundle), 200


@app.route("/", methods=["GET"])
def home():
    """Dasbor statis (Vercel: satu deployment untuk UI + API)."""
    return send_from_directory(_FRONTEND_DIR, "index.html")


@app.route("/style.css", methods=["GET"])
def serve_css():
    return send_from_directory(_FRONTEND_DIR, "style.css")


@app.route("/script.js", methods=["GET"])
def serve_js():
    return send_from_directory(_FRONTEND_DIR, "script.js")


@app.route("/health", methods=["GET"])
def health():
    """Cek cepat: apakah env API terbaca di Vercel (nilai key tidak pernah dikirim)."""
    gk = bool(env_gemini_key())
    wk = bool(env_weather_key())
    fe_ok = os.path.isdir(_FRONTEND_DIR) and os.path.isfile(
        os.path.join(_FRONTEND_DIR, "index.html")
    )
    return (
        jsonify(
            {
                "status": "ok",
                "gemini_configured": gk,
                "weather_configured": wk,
                "frontend_static_ok": fe_ok,
                "gemini_model": env_gemini_model_name() if gk else None,
                "hint": None
                if (gk and wk)
                else "Set GEMINI_API_KEY (atau GOOGLE_API_KEY) dan WEATHER_API_KEY di Vercel, centang semua environment, redeploy.",
            }
        ),
        200,
    )

if __name__ == '__main__':
    # Render membutuhkan port dari environment variable
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
