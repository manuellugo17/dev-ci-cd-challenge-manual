const request = require('supertest');
const app = require('../src/app');

beforeAll(() => {
  process.env.APP_ENV = 'test';
});

afterAll(() => {
  delete process.env.APP_ENV;
});

describe('GET /health', () => {

  it('should return 200 and status ok', async () => {
    const response = await request(app).get('/health');
    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('should include env in response body', async () => {
    const response = await request(app).get('/health');
    expect(response.body.env).toBe('test');
  });

  it('should return 404 for unknown routes', async () => {
    const response = await request(app).get('/ruta-inexistente');
    expect(response.statusCode).toBe(404);
  });

});