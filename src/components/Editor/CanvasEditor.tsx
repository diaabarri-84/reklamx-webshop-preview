import React, { useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric';
import {
  Type,
  Square,
  Circle,
  Trash2,
  Save,
  ImagePlus,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { useAuth } from '../../App';

// Inlined into the design JSON, which must fit a Firestore document.
const MAX_IMAGE_BYTES = 500 * 1024;

interface CanvasEditorProps {
  initialData?: string;
  /** Receives the design as JSON, plus a PNG the shop can actually print. */
  onSave?: (data: string, previewPng: string) => void;
  saving?: boolean;
  width?: number;
  height?: number;
}

export default function CanvasEditor({ initialData, onSave, saving = false, width = 800, height = 600 }: CanvasEditorProps) {
  const { t } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const [canvas, setCanvas] = useState<fabric.Canvas | null>(null);
  const [activeObject, setActiveObject] = useState<fabric.Object | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const c = new fabric.Canvas(canvasRef.current, {
      width,
      height,
      backgroundColor: '#ffffff',
    });

    if (initialData) {
      c.loadFromJSON(initialData, c.renderAll.bind(c));
    }

    c.on('selection:created', (e: any) => setActiveObject(e.selected?.[0] || null));
    c.on('selection:updated', (e: any) => setActiveObject(e.selected?.[0] || null));
    c.on('selection:cleared', () => setActiveObject(null));

    setCanvas(c);

    return () => {
      c.dispose();
    };
  }, [width, height]);

  /*
   * THE 800px CANVAS ON A 390px PHONE.
   *
   * The design surface is 800x600 because that is the shape the shop prints —
   * DESIGN_WIDTH_CM x DESIGN_HEIGHT_CM on the roll — and the saved PNG is
   * rendered from it at 2x. On a phone that 800px board sat inside a 134px
   * column (the properties panel took 256 of the 390), so a customer following
   * the "Design online" link from the home page arrived at a white slab with
   * one corner of the artboard showing and no way to see the rest.
   *
   * The drawing surface KEEPS its 800x600 backstore — the print file must not
   * change because somebody opened the shop on a phone. Only its CSS size is
   * scaled down to whatever room the column has, and fabric divides pointer
   * coordinates by exactly that ratio, so taps still land where they look.
   */
  useEffect(() => {
    const area = canvasAreaRef.current;
    if (!canvas || !area) return;

    const fit = () => {
      // The padding around the artboard, so it never touches the column edge.
      const availW = Math.max(120, area.clientWidth - 24);
      const availH = Math.max(120, area.clientHeight - 24);
      const scale = Math.min(1, availW / width, availH / height);
      canvas.setDimensions(
        { width: `${Math.round(width * scale)}px`, height: `${Math.round(height * scale)}px` },
        { cssOnly: true },
      );
      canvas.requestRenderAll();
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(area);
    return () => ro.disconnect();
  }, [canvas, width, height]);

  const addText = () => {
    if (!canvas) return;
    const text = new fabric.IText(t('edTextPlaceholder'), {
      left: 100,
      top: 100,
      fontFamily: 'Inter',
      fontSize: 24,
    });
    canvas.add(text);
    canvas.setActiveObject(text);
  };

  const addRect = () => {
    if (!canvas) return;
    const rect = new fabric.Rect({
      left: 100,
      top: 100,
      fill: '#3b82f6',
      width: 100,
      height: 100,
    });
    canvas.add(rect);
    canvas.setActiveObject(rect);
  };

  const addCircle = () => {
    if (!canvas) return;
    const circle = new fabric.Circle({
      left: 100,
      top: 100,
      fill: '#ef4444',
      radius: 50,
    });
    canvas.add(circle);
    canvas.setActiveObject(circle);
  };

  const addImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canvas) return;
    e.target.value = '';

    // The design is stored as JSON with the image inlined, and that whole
    // document has to fit inside Firestore's 1 MiB limit.
    if (file.size > MAX_IMAGE_BYTES) {
      setNotice(
        t('edImageTooLarge')
          .replace('{0}', (file.size / 1024 / 1024).toFixed(1))
          .replace('{1}', String(MAX_IMAGE_BYTES / 1024 / 1024)),
      );
      return;
    }

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const img = await fabric.FabricImage.fromURL(String(ev.target?.result));
        // Fit inside the canvas rather than dropping a 4000px photo on it.
        const scale = Math.min(1, (width * 0.7) / (img.width ?? 1), (height * 0.7) / (img.height ?? 1));
        img.scale(scale);
        img.set({ left: 60, top: 60 });
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.requestRenderAll();
        setNotice(null);
      } catch {
        setNotice(t('edImageLoadFailed'));
      }
    };
    reader.onerror = () => setNotice(t('cfgFileReadError'));
    reader.readAsDataURL(file);
  };

  const deleteObject = () => {
    if (!canvas || !activeObject) return;
    canvas.remove(activeObject);
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  };

  const handleSave = () => {
    if (!canvas || !onSave) return;
    // The JSON is what reopens the design; the PNG is what the shop prints.
    // Saving only the JSON left production with nothing usable.
    const png = canvas.toDataURL({ format: 'png', multiplier: 2 });
    onSave(JSON.stringify(canvas.toJSON()), png);
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 rounded-xl overflow-hidden border border-gray-200 shadow-sm">
      {/* Toolbar — wraps instead of pushing "Save design" off the right edge,
          which is what it did at 320px. */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 px-2 sm:px-4 py-2 bg-white border-b border-gray-200">
        <div className="flex items-center space-x-2">
          <button onClick={addText} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title={t('edAddText')}>
            <Type className="w-5 h-5 text-gray-600" />
          </button>
          <button onClick={addRect} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title={t('edAddRectangle')}>
            <Square className="w-5 h-5 text-gray-600" />
          </button>
          <button onClick={addCircle} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title={t('edAddCircle')}>
            <Circle className="w-5 h-5 text-gray-600" />
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title={t('edAddImage')}
          >
            <ImagePlus className="w-5 h-5 text-gray-600" />
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={addImage} className="hidden" />
          <div className="w-px h-6 bg-gray-200 mx-2" />
          <button onClick={deleteObject} disabled={!activeObject} className={cn("p-2 rounded-lg transition-colors", activeObject ? "hover:bg-red-50 text-red-600" : "text-gray-300")} title={t('umConfirmDelete')}>
            <Trash2 className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? t('edSaving') : t('edSaveDesign')}
          </button>
        </div>
      </div>

      {notice && (
        <div role="alert" className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-900 text-xs font-bold">
          {notice}
        </div>
      )}

      {/* Main Area — the properties panel sits BESIDE the artboard on a desktop
          and BELOW it on a phone, where a 256px column would have left the
          canvas 134px of a 390px screen. */}
      <div className="flex-1 flex flex-col-reverse md:flex-row overflow-hidden min-h-0">
        {/* Properties panel */}
        <div className="w-full md:w-64 shrink-0 bg-white border-t md:border-t-0 md:border-r border-gray-200 p-4 overflow-y-auto max-h-[40%] md:max-h-none">
          <h3 className="text-sm font-semibold text-gray-900 mb-4 uppercase tracking-wider">{t('edProperties')}</h3>
          {activeObject ? (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">{t('edColour')}</label>
                <input 
                  type="color" 
                  value={activeObject.fill as string || '#000000'} 
                  onChange={(e) => {
                    activeObject.set('fill', e.target.value);
                    canvas?.requestRenderAll();
                  }}
                  className="w-full h-10 rounded-lg cursor-pointer border border-gray-200"
                />
              </div>
              {activeObject.type === 'i-text' && (
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">{t('edFontSize')}</label>
                  <input 
                    type="number" 
                    value={(activeObject as fabric.IText).fontSize} 
                    onChange={(e) => {
                      (activeObject as fabric.IText).set('fontSize', parseInt(e.target.value));
                      canvas?.requestRenderAll();
                    }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  />
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic">{t('edSelectObject')}</p>
          )}
        </div>

        {/* Canvas Area */}
        <div
          ref={canvasAreaRef}
          className="flex-1 min-h-[15rem] min-w-0 bg-gray-100 p-3 sm:p-8 flex items-center justify-center overflow-hidden"
        >
          <div className="bg-white shadow-2xl rounded-sm max-w-full">
            <canvas ref={canvasRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
