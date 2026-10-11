"""Lightweight real-data predictor for a short Render free-tier demo.

The TabPFN implementation remains in tabpfn_predictor.py for the sponsor build.
This service uses the same published crop recommendation dataset but avoids
downloading large foundation-model weights on a 512 MB free instance.
"""

import hmac
import os
import warnings
from pathlib import Path

os.environ.setdefault('OMP_NUM_THREADS', '1')
warnings.filterwarnings('ignore')

import pandas as pd
from flask import Flask, jsonify, request
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.preprocessing import LabelEncoder


app = Flask(__name__)
api_token = os.getenv('PREDICTOR_API_TOKEN', '')
csv_path = Path(__file__).resolve().parent.parent / 'data' / 'Crop_recommendation.csv'

if not csv_path.is_file():
    raise FileNotFoundError(f'Real crop dataset not found: {csv_path}')

data = pd.read_csv(csv_path)
required = {'temperature', 'humidity', 'label'}
missing = required.difference(data.columns)
if missing:
    raise ValueError(f'Dataset is missing required columns: {", ".join(sorted(missing))}')

# The request currently supplies only live temperature and humidity, so train
# on those same real features. Other dataset fields are intentionally excluded.
data = data.dropna(subset=['temperature', 'humidity', 'label'])
encoder = LabelEncoder()
y_train = encoder.fit_transform(data['label'].astype(str).str.strip().str.lower())
x_train = data[['temperature', 'humidity']].astype(float)
classifier = HistGradientBoostingClassifier(
    max_iter=100,
    learning_rate=0.08,
    max_leaf_nodes=15,
    min_samples_leaf=12,
    l2_regularization=1.0,
    random_state=42,
)
classifier.fit(x_train, y_train)


@app.get('/healthz')
def healthz():
    return jsonify(status='ok', model='scikit-learn-demo')


@app.post('/predict')
def predict():
    if api_token:
        supplied = request.headers.get('Authorization', '')
        if not hmac.compare_digest(supplied, f'Bearer {api_token}'):
            return jsonify(error='Unauthorized'), 401

    payload = request.get_json(silent=True) or {}
    seed_type = payload.get('seed_type')
    current_temp = payload.get('current_temp')
    current_humidity = payload.get('current_humidity')
    if not isinstance(seed_type, str) or not seed_type.strip():
        return jsonify(error='seed_type must be a non-empty string'), 400
    if (isinstance(current_temp, bool) or not isinstance(current_temp, (int, float))
            or isinstance(current_humidity, bool) or not isinstance(current_humidity, (int, float))):
        return jsonify(error='current_temp and current_humidity must be numbers'), 400

    try:
        target_index = int(encoder.transform([seed_type.strip().lower()])[0])
    except ValueError:
        return jsonify(score=50.0, is_known_crop=False)

    x_test = pd.DataFrame([{
        'temperature': float(current_temp),
        'humidity': float(current_humidity),
    }])
    probability = float(classifier.predict_proba(x_test)[0, target_index])
    viability_index = min(100.0, round(probability * len(encoder.classes_) * 50.0, 1))
    return jsonify(
        score=viability_index,
        viability_index=viability_index,
        raw_probability=probability,
        is_known_crop=True,
    )


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('PORT', '5000')), debug=False, threaded=False)
