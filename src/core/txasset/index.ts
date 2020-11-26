import { Service, Inject } from 'typedi';
import { ITxOutpoint } from '@interfaces/ITxOutpoint';
import { Pool } from 'pg';
import { ITXOutput } from '@interfaces/ITxOutput';
import { ITXSpendInfo } from '@interfaces/ISpendInfo';
import InvalidParamError from '../../services/error/InvalidParamError';
import { ContextFactory } from '../../bootstrap/middleware/di/diContextFactory';
import { IAccountContext } from '@interfaces/IAccountContext';
import * as bsv from 'bsv';
import { Readable } from 'stream';
import { from } from 'pg-copy-streams';
import { ITxOutRecord } from '@interfaces/ITxOutRecord';
import * as pgbyte from 'postgres-bytea';

@Service('txassetModel')
class TxassetModel {

  constructor(@Inject('db') private db: ContextFactory) {}

  public async isTxExist(accountContext: IAccountContext, assetid: string): Promise<boolean> {
    const client = await this.db.getAssetDbClient(accountContext);
    let result: any = await client.query(`SELECT assetid FROM txasset WHERE assetid = decode(${assetid}, 'hex') AND blockhash IS NOT NULL`);
    return !!result.rows[0];
  }

  public async getTxParts(accountContext: IAccountContext, txid: string): Promise<any> {
    const client = await this.db.getAssetDbClient(accountContext);
    const  c = `SELECT * FROM tx WHERE txid = decode('${txid}', 'hex') ORDER BY n ASC`;
    let result: any = await client.query(c);
    return result.rows;
  }

  public async getTxPartsMany(accountContext: IAccountContext, txids: [string]): Promise<any> {
    const client = await this.db.getAssetDbClient(accountContext);
    const frag = this.getTxidFragments(txids);
    const c = `SELECT * FROM tx WHERE txid IN (${frag}) ORDER BY txid, n ASC`;
    let result: any = await client.query(c);
    return result.rows;
  }

  public async getSpendInfos(accountContext: IAccountContext, txOutpoints: ITxOutpoint[]): Promise<{[k: string]: ITXSpendInfo}> {
    const client = await this.db.getAssetDbClient(accountContext);
    if (!txOutpoints || !txOutpoints.length) {
      return {};
    }
    let frag = this.getOutputFragments(txOutpoints);
    const q = `
    SELECT encode(txid, 'hex') as txiddecode, n, prevn, height, encode(prevtxid, 'hex') as prevtxiddecode FROM tx
    WHERE (prevtxid, prevn) IN (` + frag + ')';
    let result = await client.query(q);

    const txOutMap = {};
    const baseTxOutMapNulls = {};
    for (const txout of txOutpoints) {
      baseTxOutMapNulls[txout.txid + `_o${txout.index}`] = null;
    }

    for (const row of result.rows) {
      txOutMap[row.prevtxiddecode + `_o${row.prevn}`] = {
        spend_txid:  row.txiddecode,
        spend_index: row.n,
        spend_height: row.height
      }
    }
    return { ...baseTxOutMapNulls, ...txOutMap };
  }

  public async getUtxosByScriptHash(accountContext: IAccountContext, scripthashes: string [], params): Promise<any[]> {
    const client = await this.db.getAssetDbClient(accountContext);
    if (!scripthashes || !scripthashes.length) {
      return [];
    }
    let frag = this.getScriptHashFragments(scripthashes);
    let order = 'desc';
    if (params.order === 'asc') {
      order = 'asc';
    }
    let limit = 1000;
    if (params.limit) {
      limit = parseInt(params.limit, 10);
    }

    if (limit > 1000) {
      throw new InvalidParamError();
    }

    if (limit < 100) {
      limit = 100;
    }

    if (isNaN(limit)) {
      throw new InvalidParamError();
    }
    let offset = 0;
    if (params.offset) {
      offset = parseInt(params.offset, 10);
    }
    if (offset < 0 || isNaN(offset)) {
      offset = 0;
    }

    const q = `
    SELECT
    utxo.satoshis,
    encode( utxo.scripthash, 'hex') as scripthashdecode,
    encode( utxo.txid, 'hex') as txiddecode,
    utxo.n, utxo.prevn, utxo.height,
    encode( utxo.lockscript, 'hex') as scriptdecode,
    encode( utxo.prevtxid, 'hex') as prevtxiddecode

    FROM
    tx utxo
    LEFT OUTER JOIN tx spender ON (utxo.txid = spender.prevtxid AND utxo.n = spender.prevn)

    WHERE
    (utxo.scripthash) IN (` + frag + `)
    AND
    spender.prevtxid IS NULL
    ORDER BY utxo.id ${order}
    OFFSET ${offset}
    LIMIT ${limit}
    `;
    console.log('q', q);

    let result = await client.query(q);


    let reformatted = [];
    for (const row of result.rows) {

      reformatted.push({
        txid: row.txiddecode,
        index: Number(row.n),
        satoshis: Number(row.satoshis),
        script: row.scriptdecode,
        scripthash: row.scripthashdecode,
        height: row.height
      })
    }
    return reformatted;
  }

  public async getBalanceByScriptHash(accountContext: IAccountContext, scripthashes: string[]): Promise<any> {
    const client = await this.db.getAssetDbClient(accountContext);
    let frag = this.getScriptHashFragments(scripthashes);

    const q = `
    SELECT
    sum(utxo.satoshis),
    encode( utxo.scripthash, 'hex') as scripthash
    FROM tx utxo
    LEFT OUTER JOIN tx spender
    ON (utxo.txid = spender.prevtxid AND utxo.n = spender.prevn)
    WHERE
    utxo.scripthash IN (` + frag + `)
    AND
    spender.prevtxid IS NULL

    GROUP BY utxo.scripthash
    `;

    let result = await client.query(q);
    let formatted = [];
    for (const item of result.rows) {
      formatted.push({
        satoshis: Number(item.sum),
        scripthash: item.scripthash
      });
    }
    return formatted;
  }

  public async getTxoutsByScriptHash(accountContext: IAccountContext, scripthashes: string [], params): Promise<any[]> {
    const client = await this.db.getAssetDbClient(accountContext);
    if (!scripthashes || !scripthashes.length) {
      return [];
    }
    let frag = this.getScriptHashFragments(scripthashes);
    let order = 'desc';
    if (params.order === 'asc') {
      order = 'asc';
    }

    let limit = 1000;
    if (params.limit) {
      limit = parseInt(params.limit, 10);
    }

    if (isNaN(limit)) {
      throw new InvalidParamError();
    }
    if (limit > 1000) {
      throw new InvalidParamError();
    }

    if (limit < 100) {
      limit = 100;
    }


    let offset = 0;
    if (params.offset) {
      offset = parseInt(params.offset, 10);
    }
    if (offset < 0 || isNaN(offset)) {
      offset = 0;
    }

    const q = `
    SELECT
    satoshis,
    encode(scripthash, 'hex') as scripthashdecode,
    encode(txid, 'hex') as txiddecode,
    n, prevn, height,
    encode(lockscript, 'hex') as scriptdecode,
    encode(prevtxid, 'hex') as prevtxiddecode
    FROM tx
    WHERE (scripthash) IN (` + frag + `)
    ORDER BY height ${order}, txid, n DESC
    OFFSET ${offset}
    LIMIT ${limit}
    `;
    let result = await client.query(q);

    let reformatted = [];
    for (const row of result.rows) {
      reformatted.push({
        txid: row.txiddecode,
        index: Number(row.n),
        satoshis: Number(row.satoshis),
        script: row.scriptdecode,
        scripthash: row.scripthashdecode,
        height: row.height
      })
    }
    return reformatted;
  }

  public async getTxHistoryByScriptHash(accountContext: IAccountContext, scripthashes: string [], params: any): Promise<any[]> {
    const client = await this.db.getAssetDbClient(accountContext);
    if (!scripthashes || !scripthashes.length) {
      return [];
    }
    let frag = this.getScriptHashFragments(scripthashes);
    let order = 'desc';
    let orderSign = '<';
    if (params.order === 'asc') {
      order = 'asc';
      orderSign = '>';
    }
    let limit = 1000;
    if (params.limit) {
      limit = parseInt(params.limit, 10);
    }

    if (isNaN(limit)) {
      throw new InvalidParamError();
    }
    if (limit > 1000) {
      throw new InvalidParamError();
    }

    if (limit < 100) {
      limit = 100;
    }

    let offset = 0;
    if (params.offset) {
      offset = parseInt(params.offset, 10);
    }
    if (offset < 0 || isNaN(offset)) {
      offset = 0;
    }
    let result = null;

    let fromblockheight = null;
    if (params.fromblockheight) {
      fromblockheight = parseInt(params.fromblockheight, 10);
    }

    if (fromblockheight) {
      const q = `
      SELECT
      txid, tx.id, tx.height, tx.satoshis, tx.n, block_header.hash,
      encode(txid, 'hex') as txiddecode,
      encode(scripthash, 'hex') as scripthashdecode
      FROM tx, block_header
      WHERE (scripthash) IN (` + frag + `)
      AND
      tx.height ${orderSign} ${fromblockheight} AND
      tx.height = block_header.height
      ORDER BY id ${order}
      OFFSET ${offset}
      LIMIT ${limit}
      `;
      result = await client.query(q);
    } else {
      const q = `
      SELECT
      txid, tx.id, tx.height, tx.satoshis, tx.n, block_header.hash,
      encode(txid, 'hex') as txiddecode,
      encode(scripthash, 'hex') as scripthashdecode
      FROM tx, block_header
      WHERE (scripthash) IN (` + frag + `)
      AND
      tx.height = block_header.height
      ORDER BY id ${order}
      OFFSET ${offset}
      LIMIT ${limit}
      `;
      result = await client.query(q);
    }

    let reformatted = [];
    for (const row of result.rows) {
      reformatted.push({
        id: Number(row.id),
        txid: row.txiddecode,
        blockhash: row.hash,
        index: row.n,
        satoshis: Number(row.satoshis),
        scripthash: row.scripthashdecode,
        height: row.height
      })
    }
    return reformatted;
  }

  public async getTxouts(accountContext: IAccountContext, txOutpoints: ITxOutpoint[]): Promise<{ [k: string]: ITXOutput} > {
    const client = await this.db.getAssetDbClient(accountContext);
    if (!txOutpoints || !txOutpoints.length) {
      return {};
    }
    let frag = this.getOutputFragments(txOutpoints);
    const q = `
    SELECT
    satoshis,
    encode(scripthash, 'hex') as scripthashdecode,
    encode(txid, 'hex') as txiddecode,
    n, prevn, height,
    encode(lockscript, 'hex') as scriptdecode,
    encode(prevtxid, 'hex') as prevtxiddecode
    FROM tx
    WHERE (txid, n) IN (` + frag + ')';
    let result = await client.query(q);

    // 2. Map each found output
    const txOutMaplist = []
    for (const row of result.rows) {
      txOutMaplist.push({
        txid: row.txiddecode,
        index: Number(row.n)
      });
    }
    // 3. Reformat
    const txOutMap = {}
    for (const row of result.rows) {
      txOutMap[row.txiddecode + '_o' + row.n] = {
        txid: row.txiddecode,
        index: Number(row.n),
        satoshis: Number(row.satoshis),
        script: row.scriptdecode,
        scripthash: row.scripthashdecode,
        height: row.height
      }
    }
    return txOutMap;
  }

  public async getTxoutsScripts(accountContext: IAccountContext, txOutpoints: ITxOutpoint[]): Promise<{ [k: string]: ITXOutput} > {
    const client = await this.db.getAssetDbClient(accountContext);
    if (!txOutpoints || !txOutpoints.length) {
      return {};
    }
    let frag = this.getOutputFragments(txOutpoints);
    const q = `
    SELECT
    satoshis,
    encode(txid, 'hex') as txiddecode,
    n,
    encode(lockscript, 'hex') as scriptdecode
    FROM tx
    WHERE (txid, n) IN (` + frag + ')';
    let result = await client.query(q);

    // 2. Map each found output
    const txOutMaplist = []
    for (const row of result.rows) {
      txOutMaplist.push({
        txid: row.txiddecode,
        index: Number(row.n)
      });
    }
    // 3. Reformat
    const txOutMap = {}
    for (const row of result.rows) {
      txOutMap[row.txiddecode + '_o' + row.n] = {
        txid: row.txiddecode,
        index: Number(row.n),
        script: row.scriptdecode
      };
    }
    return txOutMap;
  }

  public async getTxBlockInfo(accountContext: IAccountContext, txids: string[]): Promise<any[]> {
    const client = await this.db.getAssetDbClient(accountContext);
    if (!txids || !txids.length) {
      return [];
    }
    let frag = this.getTxidFragments(txids);

    const q = `
    SELECT
    time,
    a.height,
    encode(a.blockhash, 'hex') as blockhashdecode,
    encode(a.txid, 'hex') as txiddecode, txindex
    FROM tx a, block_header b
    WHERE
    a.txid IN (${frag}) AND n = 0 AND
    b.hashbytes = a.blockhash`
    let result = await client.query(q);
    let reformatted = [];
    for (const row of result.rows) {
      reformatted.push({
        txid: row.txiddecode,
        blockhash: row.blockhashdecode,
        height: row.height,
        time: row.time,
        txindex: row.txindex
      })
    }
    return reformatted;
  }



  public async deleteBlockDataNewerThan(accountContext: IAccountContext, height: number): Promise<any> {
    const client = await this.db.getAssetDbClient(accountContext);
    await client.query(`
      DELETE
      FROM
        block_header
      WHERE height > $1
      `, [ height ]);

    await client.query(`
      DELETE
      FROM
        txasset
      WHERE height > $1
      `, [ height ]);

    return true;
  }

  public async getBlockHeaders(accountContext: IAccountContext, limit: number = 20): Promise<string> {
    const client = await this.db.getAssetDbClient(accountContext);
    let result: any = await client.query(`
      SELECT
        *
      FROM
        block_header
      ORDER BY height DESC
      LIMIT ${limit}
      `);

    return result.rows;
  }

  public getBlockTxRecords(client: any, height: number, block: bsv.Block): ITxOutRecord[] {
    // Get all transactions that have at least one input that matches
    // bytea.decode(input)
    var txIndex = 0;
    var txSkippedCount = 0;
    var txTotalCount = 0;
    const txidset = [];
    const blockRecords = [];
    for (const tx of block.transactions) {

      const txhash = tx.hash;
      txidset.push(txhash);
      const maxN = Math.max(tx.inputs.length, tx.outputs.length);
      for (let i = 0; i  < maxN; i++) {
        const blockRecord: any= {
          txid: Buffer.from(tx.hash, 'hex'),
          height,
          n: i,
          version: tx.version,
          assettypeid: 0,
          assetid: null,
          issuer: null,
          owner: null,
        };
        console.log('JSON', tx.toJSON());
        if (i < tx.inputs.length) {
          if (txIndex > 0) {
            blockRecord.prevn = tx.inputs[i].outputIndex;
            blockRecord.prevtxid = tx.inputs[i].prevTxId;
            blockRecord.seq = tx.inputs[i].sequenceNumber;
            blockRecord.unlockscript = tx.inputs[i].script.toBuffer();
            // Check if utxo found here
					} else if (txIndex === 0) {
						; // Do nothing for coinbae
					}
        }
        if (i < tx.outputs.length) {
					blockRecord.satoshis = tx.outputs[i].satoshis;
          blockRecord.lockscript = tx.outputs[i].script.toBuffer();
					blockRecord.scripthash = bsv.crypto.Hash.sha256(blockRecord.lockscript).reverse().toString('hex');
        }
        if (i === 0) {
					blockRecord.locktime = tx.nLockTime;
					blockRecord.ins = tx.inputs.length;
					blockRecord.outs = tx.outputs.length;
					blockRecord.blockhash = block.header.hash;
					blockRecord.txindex = txIndex;
				  //	blockRecord.unlockscript = tx.inputs[i].script;
					blockRecord.size = tx.toString().length / 2;
					txIndex++;
					// Fall through for first
        }
        blockRecords.push(blockRecord);
      }
      txTotalCount++;
    }
    console.log('blockRecords', blockRecords);
    return blockRecords;
  }

  public async generateCopyInCommands(client: any, height: number, block: bsv.Block): Promise<any> {
    const txs = block.transactions;

    const blockTxRecords: ITxOutRecord[] = this.getBlockTxRecords(client, height, block);
    return new Promise(async (resolve, reject) => {
      console.error('Ecopy in commandsn');
      if (!blockTxRecords.length) {
        return;
      }
      const stream = client.query(from('COPY txasset (version, assetid, assettypeid, issuer, owner, size, height, txid, blockhash, locktime, ins, outs, txindex, n, prevtxid, prevn, seq, unlockscript, scripthash) FROM STDIN'));
      console.error('stream', stream);
      var rs = new Readable;
      let currentIndex = 0;
      rs._read = () => {
        if (currentIndex === blockTxRecords.length) {
          rs.push(null);
        } else {
          let txo = blockTxRecords[currentIndex];
          rs.push(
            txo.version + '\t' + txo.assetid + '\t' + txo.assettypeid + '\t' + txo.issuer + '\t' +
            txo.owner + '\t' + txo.size + '\t'  + txo.height + '\t' + txo.txid + '\t' + txo.blockhash + '\t'  +
            txo.locktime + '\t' + txo.ins + '\t' + txo.outs + '\t' + txo.txindex + '\t' + txo.n + '\t' +
            txo.prevtxid + '\t' + txo.prevn + '\t' + txo.seq + '\t' + txo.unlockscript + '\t' + txo.scripthash +
            '\n');
          currentIndex = currentIndex+1;
        }
      };
      let onError = strErr => {
        console.error('Something went wrong:', strErr);
        reject(strErr);
        return;
      };
      rs.on('error', onError);
      stream.on('error', onError);
      stream.on('end', resolve);
      rs.pipe(stream);
    });
  }

  public async saveBlockData(accountContext: IAccountContext, height: number, block: bsv.Block): Promise<any> {
    const pool = await this.db.getAssetDbClient(accountContext);
    console.error('saveBlockDatan', height);
    return pool.connect(async (err, client, done) => {
      console.error('pool connect', height);
      const shouldAbort = err => {
        if (err) {
          console.error('Error in transaction', err.stack)
          client.query('ROLLBACK', err => {
            if (err) {
              console.error('Error rolling back client', err.stack)
            }
            // release the client back to the pool
            done()
          })
        }
        return !!err
      };

      console.error('saveBlockDatan', height);
      const tx = await client.query('BEGIN', async (err) => {
        try {
          if (shouldAbort(err)) {
            return;
          }
          console.error('saveBlockData copyin', height);
          await this.generateCopyInCommands(client, height, block);

          const q = `
          INSERT INTO block_header(height, hash, hashbytes, size, version, merkleroot, time, nonce, bits, difficulty, previousblockhash)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `;
          console.log('q', q, block.header, block.hash);
          let result: any = await client.query(q, [
              height,
              block.hash,
              block.hash, // Buffer.from(block.hash, 'hex'),
              block.header.size,
              block.header.version,
              block.header.merkleRoot.toString('hex'),
              block.header.time,
              block.header.nonce,
              block.header.bits,
              block.header.getTargetDifficulty(),
              block.header.prevHash.toString('hex')
            ]);
          await client.query('COMMIT');
          return result.rows;
        } catch (err) {
          shouldAbort(err);
          throw err;
        }
      });

      return tx;
    });
  }

  private getOutputFragments(txOutpoints: any[]) {
    return txOutpoints.map(t => `(decode('${t.txid}', 'hex'), ${t.index})`).join(',');
  }

  private getTxidFragments(txids: string[]) {
    return txids.map(t => `decode('${t}', 'hex')`).join(',');
 }

  private getScriptHashFragments(scripthashes: string[]) {
    return this.getTxidFragments(scripthashes);
 }

}


export default TxassetModel;
