const express = require('express');
const path = require('node:path');

const app = express();
const port = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '100kb' }));

const roleUsers = {
  patient: { id: 'patient-6409281', name: 'สมชาย ใจมั่น', role: 'patient', hn: '6409281' },
  nurse: { id: 'nurse-demo', name: 'พิมพ์ชนก ใจดี', role: 'nurse' },
  doctor: { id: 'doctor-demo', name: 'นลินี', role: 'doctor' },
  admin: { id: 'admin-demo', name: 'ผู้ดูแลระบบ', role: 'admin' }
};

const patients = [
  { hn: '6409281', name: 'สมชาย ใจมั่น', provider: 'พ.ญ. นลินี', checkCount: 8 },
  { hn: '6409274', name: 'พิมพ์วดี วัฒนา', provider: 'พ.ญ. นลินี', checkCount: 3 },
  { hn: '6409262', name: 'ธนโชติ ชูศรี', provider: 'พ.ญ. นลินี', checkCount: 5 }
];

const reports = [
  { id: 'report-6409281', hn: '6409281', date: '2026-09-30T10:36:00+07:00', mode: 'ยืนนิ่ง', copTrajectory: 'สมมาตร', archIndex: 0.24, leftRight: '52 : 48%', risk: 'ปานกลาง', examiner: 'พ.ญ. นลินี', note: '' },
  { id: 'report-6409274', hn: '6409274', date: '2026-09-30T10:12:00+07:00', mode: 'ก้าวเดิน', copTrajectory: 'สมมาตร', archIndex: 0.19, leftRight: '49 : 51%', risk: 'ความเสี่ยงต่ำ', examiner: 'พ.ญ. นลินี', note: '' },
  { id: 'report-6409262', hn: '6409262', date: '2026-09-30T09:48:00+07:00', mode: 'ยืนนิ่ง', copTrajectory: 'เบี่ยงขวา', archIndex: 0.31, leftRight: '61 : 39%', risk: 'ควรติดตาม', examiner: 'พ.ญ. นลินี', note: '' }
];
const measurementJobs = [];

const devices = [
  { id: 'PF-02', name: 'แผ่นวัดแรงกด PF-02', type: 'pressure-plate', status: 'online', lastCalibration: '2026-09-28T10:00:00+07:00', room: 'ห้องกายภาพ 1' },
  { id: 'ESP32-01', name: 'ESP32 Controller', type: 'sensor-controller', status: 'online', lastCalibration: null, room: 'ห้องกายภาพ 1' },
  { id: 'RPI5-01', name: 'Raspberry Pi 5', type: 'edge-computer', status: 'online', lastCalibration: null, room: 'ห้องกายภาพ 1' }
];

let riskCriteria = {
  archIndexLowMax: 0.21,
  archIndexMediumMax: 0.28,
  asymmetryPercent: 10
};

const rolePermissions = {
  patient: ['session:read', 'reports:read-own'],
  nurse: ['session:read', 'dashboard:read', 'patients:read', 'patients:create', 'reports:read', 'measurements:create', 'reports:print'],
  doctor: ['session:read', 'dashboard:read', 'patients:read', 'reports:read', 'reports:diagnose'],
  admin: ['session:read', 'devices:read', 'devices:calibrate', 'criteria:read', 'criteria:update']
};

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (isProduction) {
      return res.status(503).json({ error: 'Demo role authentication is disabled in production. Configure trusted authentication first.' });
    }

    const role = req.get('x-demo-role') || 'nurse';
    if (!roleUsers[role]) {
      return res.status(401).json({ error: 'Unknown demo role.' });
    }
    if (allowedRoles.length && !allowedRoles.includes(role)) {
      return res.status(403).json({ error: 'This role is not allowed to perform this action.' });
    }

    req.user = roleUsers[role];
    req.permissions = rolePermissions[role];
    next();
  };
}

function notFound(res) {
  return res.status(404).json({ error: 'Record not found.' });
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/api/health', (req, res) => res.json({ status: 'ok', mode: isProduction ? 'production' : 'demo' }));

app.get('/api/session', requireRole(), (req, res) => {
  res.json({ user: req.user, permissions: req.permissions, demo: true });
});

app.get('/api/dashboard', requireRole('nurse', 'doctor'), (req, res) => {
  res.json({
    examinedToday: reports.length,
    followUp: reports.filter(report => report.risk !== 'ความเสี่ยงต่ำ').length,
    averageDuration: '2:18',
    devicesReady: devices.filter(device => device.status === 'online').length,
    devicesTotal: devices.length,
    latestReport: reports[0]
  });
});

app.get('/api/patients', requireRole('nurse', 'doctor'), (req, res) => {
  const query = String(req.query.hn || '').trim();
  const results = query ? patients.filter(patient => patient.hn.includes(query)) : patients;
  res.json({ patients: results });
});

app.post('/api/patients', requireRole('nurse'), (req, res) => {
  const hn = String(req.body.hn || '').trim();
  const name = String(req.body.name || '').trim();
  if (!/^\d{5,12}$/.test(hn) || !name) {
    return res.status(400).json({ error: 'A valid HN and patient name are required.' });
  }
  if (patients.some(patient => patient.hn === hn)) {
    return res.status(409).json({ error: 'This HN is already registered.' });
  }

  const patient = { hn, name, provider: 'ยังไม่ระบุ', checkCount: 0 };
  patients.unshift(patient);
  res.status(201).json({ patient });
});

app.post('/api/measurements', requireRole('nurse'), (req, res) => {
  const hn = String(req.body.hn || '').trim();
  const mode = String(req.body.mode || '');
  if (!patients.some(patient => patient.hn === hn)) {
    return res.status(404).json({ error: 'Patient HN was not found. Register the patient first.' });
  }
  if (!['standing', 'walking'].includes(mode)) {
    return res.status(400).json({ error: 'Measurement mode must be standing or walking.' });
  }

  const measurement = {
    id: `measurement-${Date.now()}`,
    hn,
    mode,
    status: 'awaiting_sensor',
    requestedBy: req.user.id,
    requestedAt: new Date().toISOString()
  };
  measurementJobs.unshift(measurement);
  res.status(202).json({
    measurement,
    message: 'รับคำขอตรวจแล้ว รอการเชื่อมต่อเซนเซอร์เพื่อเริ่มวัดจริง'
  });
});

app.get('/api/reports', requireRole('patient', 'nurse', 'doctor'), (req, res) => {
  const query = String(req.query.hn || '').trim();
  if (req.user.role === 'patient' && query && query !== req.user.hn) {
    return res.status(403).json({ error: 'Patients can only access their own reports.' });
  }

  const hn = req.user.role === 'patient' ? req.user.hn : query;
  const result = hn ? reports.filter(report => report.hn === hn) : reports;
  res.json({ reports: result, patientHn: req.user.role === 'patient' ? req.user.hn : null });
});

app.post('/api/reports/:reportId/diagnosis', requireRole('doctor'), (req, res) => {
  const report = reports.find(item => item.id === req.params.reportId);
  if (!report) return notFound(res);

  const note = String(req.body.note || '').trim();
  if (!note || note.length > 2000) {
    return res.status(400).json({ error: 'A diagnosis note between 1 and 2000 characters is required.' });
  }
  report.note = note;
  report.diagnosedBy = req.user.id;
  report.diagnosedAt = new Date().toISOString();
  res.json({ report });
});

app.get('/api/devices', requireRole('admin'), (req, res) => {
  res.json({ devices });
});

app.post('/api/devices/:deviceId/calibration', requireRole('admin'), (req, res) => {
  const device = devices.find(item => item.id === req.params.deviceId);
  if (!device) return notFound(res);
  if (device.type !== 'pressure-plate') {
    return res.status(400).json({ error: 'Calibration is only available for pressure sensors.' });
  }

  device.lastCalibration = new Date().toISOString();
  res.json({ device, message: 'Demo calibration recorded.' });
});

app.get('/api/risk-criteria', requireRole('admin'), (req, res) => {
  res.json({ criteria: riskCriteria });
});

app.put('/api/risk-criteria', requireRole('admin'), (req, res) => {
  const nextCriteria = {
    archIndexLowMax: Number(req.body.archIndexLowMax),
    archIndexMediumMax: Number(req.body.archIndexMediumMax),
    asymmetryPercent: Number(req.body.asymmetryPercent)
  };
  const validNumbers = Object.values(nextCriteria).every(Number.isFinite);
  if (!validNumbers || nextCriteria.archIndexLowMax <= 0 || nextCriteria.archIndexMediumMax <= nextCriteria.archIndexLowMax || nextCriteria.asymmetryPercent < 0 || nextCriteria.asymmetryPercent > 100) {
    return res.status(400).json({ error: 'Risk criteria values are invalid.' });
  }

  riskCriteria = nextCriteria;
  res.json({ criteria: riskCriteria });
});

app.use((req, res) => res.status(404).json({ error: 'Endpoint not found.' }));

if (require.main === module) {
  app.listen(port, () => console.log(`SoleCare demo server listening on http://localhost:${port}`));
}

module.exports = { app, rolePermissions };
