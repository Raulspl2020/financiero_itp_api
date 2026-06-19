import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isEmpty, map } from 'lodash';
import { NotFoundError } from 'src/classes/httpError/notFounError';
import {
  IEnrollment,
  IPensumSubjects,
  IPensumSubjectsStudent,
  IStudentType,
} from 'src/interfaces/enrollment.interface';
import { DataSource, Repository } from 'typeorm';
import {
  ASIGNATURAS_REGISTRADAS,
  INFO_MATRICULA_SQL,
  NUMERO_MATRICULAS,
  PENSUM_MATRICULA,
} from '../constant/invoiceSql.constant';
import { UniversityPeriod } from '../entities/univsityPeriod.entity';

@Injectable()
export class EnrollmentService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(UniversityPeriod)
    private periodRepository: Repository<UniversityPeriod>,
  ) {}

  async getDatesStudentType(matriculaId: number): Promise<IStudentType> {
    const startedAt = Date.now();
    console.log(`[perf] getDatesStudentType inicio`);
    const queryRunner = this.dataSource.createQueryRunner();
    const connectStartedAt = Date.now();
    await queryRunner.connect();
    console.log(`[perf] getDatesStudentType.queryRunner.connect ${Date.now() - connectStartedAt}ms`);
    let infoMatricula: IEnrollment;
    try {
      const queryStartedAt = Date.now();
      [infoMatricula] = await queryRunner.manager.query<IEnrollment[]>(
        INFO_MATRICULA_SQL,
        [matriculaId],
      );
      console.log(`[perf] SQL getDatesStudentType.INFO_MATRICULA_SQL ${Date.now() - queryStartedAt}ms`);
    } finally {
      const releaseStartedAt = Date.now();
      if (!queryRunner.isReleased) await queryRunner.release();
      console.log(`[perf] getDatesStudentType.queryRunner.release ${Date.now() - releaseStartedAt}ms`);
    }

    if (!infoMatricula) throw new NotFoundError('No se encontro la matricula');

    const generateStartedAt = Date.now();
    const responseType = await this.generateStudentTypeByEnrollment(
      infoMatricula,
    );
    console.log(`[perf] generateStudentTypeByEnrollment ${Date.now() - generateStartedAt}ms`);
    console.log(`[perf] getDatesStudentType fin ${Date.now() - startedAt}ms`);
    console.log(`[perf] TOTAL REQUEST ${Date.now() - startedAt}ms`);
    return responseType;
  }

  async generateStudentTypeByEnrollment(
    infoMatricula: IEnrollment,
  ): Promise<IStudentType> {
    const startedAt = Date.now();
    console.log(`[perf] generateStudentTypeByEnrollment inicio`);
    const queryRunner = this.dataSource.createQueryRunner();
    const connectStartedAt = Date.now();
    await queryRunner.connect();
    console.log(`[perf] generateStudentTypeByEnrollment.queryRunner.connect ${Date.now() - connectStartedAt}ms`);

    try {
      const sqlStartedAt = Date.now();
      const [
        pensumMatricula,
        asignaturasRegistradas,
        [cantidadMatricula = { numero: 0 }],
        period,
      ] = await Promise.all([
        queryRunner.manager.query<IPensumSubjects[]>(PENSUM_MATRICULA, [
          infoMatricula.id_programa_persona,
        ]),

        queryRunner.manager.query<IPensumSubjectsStudent[]>(
          ASIGNATURAS_REGISTRADAS,
          [infoMatricula.id_programa_persona],
        ),
        queryRunner.manager.query<any[]>(NUMERO_MATRICULAS, [
          infoMatricula.id_programa_persona,
        ]),

        this.periodRepository.findOne({
          where: {
            codPeriodo: infoMatricula.cod_periodo,
            codColegio: infoMatricula.cod_colegio,
          },
        }),
      ]);
      console.log(`[perf] SQL generateStudentTypeByEnrollment.parallelQueries ${Date.now() - sqlStartedAt}ms`);
      const releaseStartedAt = Date.now();
      await queryRunner.release();
      console.log(`[perf] generateStudentTypeByEnrollment.queryRunner.release ${Date.now() - releaseStartedAt}ms`);

      const transformStartedAt = Date.now();
      const fecIniMatordinaria =
        asignaturasRegistradas[0]?.mat_ordinaria == 'Y'
          ? asignaturasRegistradas[0]?.fechaini_matord
          : period.fecIniMatordinariaAnt;

      const fecFinMatOrdinaria =
        asignaturasRegistradas[0]?.mat_ordinaria == 'Y'
          ? asignaturasRegistradas[0]?.fechafin_matord
          : period.fecFinMatOrdinariaAnt;

      if (isEmpty(pensumMatricula) && isEmpty(asignaturasRegistradas)) {
        throw new Error('No se encontraron resultados');
      }

      if (!period)
        throw new NotFoundError('No se encontro el periodo academico');

      const asigPerdidas = asignaturasRegistradas.some(
        (row) => row.cod_estadomateria === 1,
      );

      const matriculaUnica = asignaturasRegistradas.every(
        (row) => row.cod_matricula == asignaturasRegistradas[0].cod_matricula,
      );

      if (!isEmpty(pensumMatricula) && isEmpty(asignaturasRegistradas)) {
        console.log(`[perf] transformStudentType ${Date.now() - transformStartedAt}ms`);
        console.log(`[perf] generateStudentTypeByEnrollment fin ${Date.now() - startedAt}ms`);
        return {
          codigo: 1,
          descripcion: 'ESTUDIANTE_NUEVO',
          fechaInicioMatricula: period.fecIniMatordinariaNew,
          fechaFinMatricula: period.fecFinMatOrdinariaNew,
          fechaInicioMatriculaExt: period.fecIniMatextraord,
          fechaFinMatriculaExt: period.fecFinMatextraord,
          fecIniInsNuevos: period.fecIniInsNuevos,
          fecFinInsNuevos: period.fecFinInsNuevos,
        };
      }

      const newStudent = asignaturasRegistradas.every(
        (row) => row.estudiante_nuevo == 'SI',
      );

      if (newStudent && Number(cantidadMatricula?.numero) == 1) {
        console.log(`[perf] transformStudentType ${Date.now() - transformStartedAt}ms`);
        console.log(`[perf] generateStudentTypeByEnrollment fin ${Date.now() - startedAt}ms`);
        return {
          codigo: 1,
          descripcion: 'ESTUDIANTE_NUEVO',
          fechaInicioMatricula: period.fecIniMatordinariaNew,
          fechaFinMatricula: period.fecFinMatOrdinariaNew,
          fechaInicioMatriculaExt: period.fecIniMatextraord,
          fechaFinMatriculaExt: period.fecFinMatextraord,
          fecIniInsNuevos: period.fecIniInsNuevos,
          fecFinInsNuevos: period.fecFinInsNuevos,
        };
      }

      const noNivelado =
        asignaturasRegistradas.length !==
        new Set(
          asignaturasRegistradas.map((item) => item.cod_colegio_asignatura),
        ).size;

      if (!matriculaUnica) {
        if (noNivelado) {
          console.log(`[perf] transformStudentType ${Date.now() - transformStartedAt}ms`);
          console.log(`[perf] generateStudentTypeByEnrollment fin ${Date.now() - startedAt}ms`);
          return {
            codigo: 3,
            descripcion: 'ESTUDIANTE_ANTIGUO_NO_NIVELADO',
            fechaInicioMatricula: fecIniMatordinaria,
            fechaFinMatricula: fecFinMatOrdinaria,
            fechaInicioMatriculaExt: period.fecIniMatextraord,
            fechaFinMatriculaExt: period.fecFinMatextraord,
            fecIniInsNuevos: period.fecIniInsNuevos,
            fecFinInsNuevos: period.fecFinInsNuevos,
          };
        }

        const cursos = new Set(
          asignaturasRegistradas.map((item) => item.cod_curso),
        );

        for (const curso of cursos) {
          const numeroAsigRegistradas = asignaturasRegistradas.filter(
            (item) => item.cod_curso == curso,
          ).length;

          const numeroAsigPensul = asignaturasRegistradas.filter(
            (item) => item.cod_curso == curso,
          ).length;

          if (numeroAsigPensul != numeroAsigRegistradas) {
            console.log(`[perf] transformStudentType ${Date.now() - transformStartedAt}ms`);
            console.log(`[perf] generateStudentTypeByEnrollment fin ${Date.now() - startedAt}ms`);
            return {
              codigo: 3,
              descripcion: 'ESTUDIANTE_ANTIGUO_NO_NIVELADO',
              fechaInicioMatricula: fecIniMatordinaria,
              fechaFinMatricula: fecFinMatOrdinaria,
              fechaInicioMatriculaExt: period.fecIniMatextraord,
              fechaFinMatriculaExt: period.fecFinMatextraord,
              fecIniInsNuevos: period.fecIniInsNuevos,
              fecFinInsNuevos: period.fecFinInsNuevos,
            };
          }
        }
      }

      if (asigPerdidas) {
        console.log(`[perf] transformStudentType ${Date.now() - transformStartedAt}ms`);
        console.log(`[perf] generateStudentTypeByEnrollment fin ${Date.now() - startedAt}ms`);
        return {
          codigo: 3,
          descripcion: 'ESTUDIANTE_ANTIGUO_NO_NIVELADO',
          fechaInicioMatricula: fecIniMatordinaria,
          fechaFinMatricula: fecFinMatOrdinaria,
          fechaInicioMatriculaExt: period.fecIniMatextraord,
          fechaFinMatriculaExt: period.fecFinMatextraord,
          fecIniInsNuevos: period.fecIniInsNuevos,
          fecFinInsNuevos: period.fecFinInsNuevos,
        };
      }

      console.log(`[perf] transformStudentType ${Date.now() - transformStartedAt}ms`);
      console.log(`[perf] generateStudentTypeByEnrollment fin ${Date.now() - startedAt}ms`);
      return {
        codigo: 2,
        descripcion: 'ESTUDIANTE_ANTIGUO_NIVELADO',
        fechaInicioMatricula: period.fecIniMatordinariaAnt,
        fechaFinMatricula: period.fecFinMatOrdinariaAnt,
        fechaInicioMatriculaExt: period.fecIniMatextraord,
        fechaFinMatriculaExt: period.fecFinMatextraord,
        fecIniInsNuevos: period.fecIniInsNuevos,
        fecFinInsNuevos: period.fecFinInsNuevos,
      };
    } catch (error) {
      if (!queryRunner.isReleased) {
        await queryRunner.release();
      }
      console.log(`[perf] generateStudentTypeByEnrollment fin ${Date.now() - startedAt}ms`);
      throw new Error('Error al generar las fechas de matricula');
    }
  }
}
