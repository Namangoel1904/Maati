#!/usr/bin/env python3
"""Local Flask microservice for TabPFN crop suitability inference."""

import os
import warnings
from pathlib import Path

warnings.filterwarnings('ignore')
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / '.env')
os.environ.setdefault('TABPFN_NO_BROWSER', '1')

import pandas as pd
from flask import Flask, jsonify, request
from sklearn.preprocessing import LabelEncoder
from tabpfn import TabPFNClassifier


app = Flask(__name__)
csv_path = Path(__file__).resolve().parent.parent / 'data' / 'Crop_recommendation.csv'
print('Loading crop dataset and initializing TabPFN...', flush=True)
if not csv_path.is_file():
    raise FileNotFoundError(f'Real crop dataset not found: {csv_path}')

data = pd.read_csv(csv_path)
required = {'N', 'P', 'K', 'temperature', 'humidity', 'ph', 'rainfall', 'label'}
missing = required.difference(data.columns)
if missing:
    raise ValueError(f'Dataset is missing required columns: {", ".join(sorted(missing))}')
data = data.dropna(subset=['temperature', 'humidity', 'label'])
data = data.sample(frac=1, random_state=42).groupby('label').head(10).reset_index(drop=True)

# Only weather features are used because the API has no live soil measurements.
label_encoder = LabelEncoder()
y_train = label_encoder.fit_transform(data['label'].astype(str).str.strip().str.lower())
x_train = data[['temperature', 'humidity']].astype(float)
classifier = TabPFNClassifier(device='cpu')
classifier.fit(x_train, y_train)
print('TabPFN predictor ready at http://127.0.0.1:5000', flush=True)


@app.get('/healthz')
def healthz():
    return jsonify(status='ok', model='ready')


@app.post('/predict')
def predict():
    payload = request.get_json(silent=True) or {}
    seed_type = payload.get('seed_type')
    current_temp = payload.get('current_temp')
    current_humidity = payload.get('current_humidity')
    if not isinstance(seed_type, str) or not seed_type.strip():
        return jsonify(error='seed_type must be a non-empty string'), 400
    if (isinstance(current_temp, bool) or not isinstance(current_temp, (int, float))
            or isinstance(current_humidity, bool) or not isinstance(current_humidity, (int, float))):
        return jsonify(error='current_temp and current_humidity must be numbers'), 400

    target = seed_type.strip().lower()
    try:
        target_index = int(label_encoder.transform([target])[0])
    except ValueError:
        return jsonify(score=50.0, is_known_crop=False)

    x_test = pd.DataFrame([{
        'temperature': float(current_temp),
        'humidity': float(current_humidity),
    }])
    probability = float(classifier.predict_proba(x_test)[0, target_index])
    viability_index = min(
        100.0,
        round(float((probability / (1.0 / len(label_encoder.classes_))) * 50.0), 1),
    )
    return jsonify(
        score=viability_index,
        viability_index=viability_index,
        raw_probability=probability,
        is_known_crop=True,
    )


if __name__ == '__main__':
    app.run(host=os.getenv('HOST', '0.0.0.0'), port=int(os.getenv('PORT', '5000')), debug=False, threaded=False)
