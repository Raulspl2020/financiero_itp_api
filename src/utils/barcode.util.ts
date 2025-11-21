import * as bwipjs from 'bwip-js';
import {
  IBarcodeInput,
  IBarcodeOutput,
} from 'src/interfaces/bbvaCash.interface';
import * as moment from 'moment';
import { ConfigHelper } from './configHelper.util';

export const generarCodigoBarrasString = ({
  limitDate,
  reference,
  value,
}: IBarcodeInput): IBarcodeOutput => {
  // https://gs1co.org/servicios/codigos-de-barras/calculo-del-digito-de-control
  const convenio415: string = ConfigHelper.getBarcodeGs1();
  let referencia8020: string = reference;

  let valor390n: string = value.toString();
  const fecha96: string = moment(limitDate).format('YYYYMMDD');

  const length8020 = 12;
  const length390n = 10;

  if (referencia8020.length > length8020) {
    throw new Error('El codigo de referencia supera el máximo permitido');
  }

  if (valor390n.length > length390n) {
    throw new Error('El valor supera el máximo permitido');
  }

  if (referencia8020.length <= length8020) {
    const faltante = length8020 - referencia8020.length;
    for (let i = 0; i < faltante; i++) {
      referencia8020 = '0' + referencia8020;
    }
  }

  if (valor390n.length <= length390n) {
    const faltante = length390n - valor390n.length;
    for (let i = 0; i < faltante; i++) {
      valor390n = '0' + valor390n;
    }
  }

  const codigoBarras = `415${convenio415}8020${referencia8020}3900${valor390n}96${fecha96}`;
  const text = `(415)${convenio415}(8020)${referencia8020}(3900)${valor390n}(96)${fecha96}`;

  return {
    barcode: codigoBarras,
    barcodeText: text,
  };
};

export const dividirCodigoBarrasText = (cadena: string) => {
  const convenio415 = cadena.substring(0, 16);
  const referencia8020 = cadena.substring(16, 16);
  const valor3900 = cadena.substring(16 + 16, 14);
  const fecha96 = cadena.substring(16 + 16 + 14, 10);
  return { convenio415, referencia8020, valor3900, fecha96 };
};

export const generarCodigoBarras = async ({
  limitDate,
  reference,
  value,
}: IBarcodeInput): Promise<IBarcodeOutput> => {

  value = Math.round(value);

  const { barcode, barcodeText } = generarCodigoBarrasString({
    limitDate,
    reference,
    value,
  });

  const bufferCode = await bwipjs.toBuffer({
    bcid: 'gs1-128', // Barcode type
    text: barcodeText, // Text to encode
    height: 15, // Bar height, in millimeters
    includetext: true, // Show human-readable text
    textxalign: 'center', // Always good to set this
    alttext: barcodeText,
    width: 108,
    scaleX: 5,
    scaleY: 5,
    textyoffset: 2,
    textxoffset: 1,
    textsize: 9,
  });

  return {
    barcode,
    barcodeText,
    barcodeBase64: bufferCode.toString('base64'),
  };
};
