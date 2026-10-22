import { Body, Controller, Post, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

@Controller('forgetful')
class ForgetfulController {
  @Post()
  create(@Body() body: unknown): unknown {
    return body;
  }
}

describe('the global validation boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ForgetfulController],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('fails loudly when a route forgets its schema, naming the route', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/forgetful')
      .send({ anything: true })
      .expect(500);

    expect(response.body.statusCode).toBe(500);
    expect(response.body.message).toContain('No Zod schema registered for POST /api/forgetful');
  });

  it('leaves a bodyless POST alone', async () => {
    const response = await request(app.getHttpServer()).post('/api/forgetful').expect(201);

    expect(response.body).toEqual({});
  });
});
