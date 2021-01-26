import { Service, Inject } from 'typedi';
import { DateUtil } from '../../services/helpers/DateUtil';
import { IAccountContext } from '@interfaces/IAccountContext';
import { ContextFactory } from '../../bootstrap/middleware/di/diContextFactory';

@Service('txfilterModel')
class TxfilterModel {

  constructor(@Inject('db') private db: ContextFactory) {}

  public async create(accountContext: IAccountContext, name: string, payload: string, enabled: boolean, groupname: string): Promise<string> {
    const client = await this.db.getClient(accountContext);
    const now = DateUtil.now();
    let result: any = await client.query(`
    INSERT INTO txfilter(name, payload, enabled, created_at, updated_at, groupname)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT(name) 
    DO UPDATE 
    SET 
    enabled = excluded.enabled, 
    payload = excluded.payload, 
    groupname = excluded.groupname, 
    updated_at = excluded.updated_at
    RETURNING id`, [
      name, payload, enabled, now, now, groupname
    ]);
    return result.rows;
  }

  public async delete(accountContext: IAccountContext, name: string): Promise<string> {
    const client = await this.db.getClient(accountContext);
    let result: any = await client.query(`
    DELETE FROM txfilter WHERE name = $1`, [
      name,
    ]);
    return result.rows;
  }
 
  public async getAll(accountContext: IAccountContext): Promise<string> {
    const client = await this.db.getClient(accountContext);
    let result: any = await client.query(`
    SELECT * FROM txfilter ORDER BY name ASC`);
    return result.rows;
  }

  public async getByGroupName(accountContext: IAccountContext, groupname?: string): Promise<string> {
    const client = await this.db.getClient(accountContext);
    let result: any = await client.query(`
    SELECT * FROM txfilter WHERE groupname = $1 ORDER BY name ASC`, [ groupname ]);
    return result.rows;
  }

  public async getByGroupNameEnabled(accountContext: IAccountContext, groupname?: string): Promise<string> {
    const client = await this.db.getClient(accountContext);
    let result: any = await client.query(`
    SELECT * FROM txfilter WHERE groupname = $1 AND enabled is true ORDER BY name ASC`, [ groupname ]);
    return result.rows;
  }

  public async getAllEnabled(accountContext: IAccountContext): Promise<string> {
    const client = await this.db.getClient(accountContext);
    let result: any = await client.query(`
    SELECT * FROM txfilter WHERE enabled is true ORDER BY name ASC`);
    return result.rows;
  }
}

export default TxfilterModel;
