// Generador de la macro VBA que da formato al Excel exportado para dejarlo
// idéntico a la sábana de validación de referencia (Arial 8, cabecera gris,
// bordes finos, estadísticas en verde, checks en Wingdings).
//
// La macro no depende de la posición fija de las columnas: localiza la cabecera
// buscando "Parámetros" en la columna A y las estadísticas por su título, de
// modo que funciona con cualquier cantidad de lotes y cualquier producto.

export const MACRO_MODULE_NAME = "FormatoValidacion";

export const MACRO_VBA = `Attribute VB_Name = "${MACRO_MODULE_NAME}"
Option Explicit

'==============================================================================
' FORMATO DE SABANA DE VALIDACION
'
' Aplica a todas las hojas del libro activo el formato de la sabana de
' recoleccion de datos de validacion:
'   - Fuente Arial 8 (cabecera 7.5 negrita), letra negra
'   - Bordes finos en toda la tabla
'   - Cabecera con relleno gris y texto centrado
'   - Filas de seccion en gris claro y negrita
'   - Columnas de estadistica (Minimo/Maximo/Promedio/Desviacion) en verde
'   - Celdas de verificacion "u" mostradas como visto bueno (Wingdings)
'   - Paneles inmovilizados y anchos de columna ajustados
'
' USO: Alt+F11 > Archivo > Importar archivo... > seleccionar este .bas
'      Luego Alt+F8 > FormatearTablasValidacion > Ejecutar
'==============================================================================

' --- Ajustes rapidos -------------------------------------------------------
Const FUENTE          As String = "Arial"
Const TAM_DATOS       As Single = 8
Const TAM_CABECERA    As Single = 7.5
Const TAM_TITULO      As Single = 11
Const FORMATO_DATOS   As String = "General"
Const FORMATO_ESTADIS As String = "0.000"
Const ANCHO_PARAMETRO As Single = 46
Const ANCHO_SETPOINT  As Single = 26
Const ANCHO_LOTE      As Single = 12
Const ANCHO_ESTADIS   As Single = 12
' ---------------------------------------------------------------------------

Public Sub FormatearTablasValidacion()
    Dim ws As Worksheet
    Dim hojas As Long

    Application.ScreenUpdating = False

    For Each ws In ActiveWorkbook.Worksheets
        If FormatearHoja(ws) Then hojas = hojas + 1
    Next ws

    Application.ScreenUpdating = True

    If hojas = 0 Then
        MsgBox "No se encontro ninguna tabla con la cabecera 'Parametros'.", _
               vbExclamation, "Formato de validacion"
    Else
        MsgBox "Formato aplicado a " & hojas & " hoja(s).", _
               vbInformation, "Formato de validacion"
    End If
End Sub

Private Function FormatearHoja(ws As Worksheet) As Boolean
    Dim filaCab As Long, ultimaFila As Long, ultimaCol As Long
    Dim colEstadis As Long, colPrimerLote As Long
    Dim f As Long, c As Long
    Dim celda As Range

    filaCab = BuscarFilaCabecera(ws)
    If filaCab = 0 Then Exit Function

    ultimaFila = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    ultimaCol = ws.Cells(filaCab, ws.Columns.Count).End(xlToLeft).Column
    colEstadis = BuscarColumnaEstadistica(ws, filaCab, ultimaCol)
    colPrimerLote = 3
    If colEstadis = 0 Then colEstadis = ultimaCol - 3

    ' --- Base: toda la tabla ---
    With ws.Range(ws.Cells(filaCab, 1), ws.Cells(ultimaFila, ultimaCol))
        .Font.Name = FUENTE
        .Font.Size = TAM_DATOS
        .Font.Color = RGB(0, 0, 0)
        .Font.Bold = False
        .Interior.Pattern = xlNone
        .VerticalAlignment = xlCenter
        .Borders.LineStyle = xlContinuous
        .Borders.Weight = xlThin
        .Borders.Color = RGB(0, 0, 0)
    End With

    ' --- Titulo (fila 1) ---
    If filaCab > 1 Then
        With ws.Range(ws.Cells(1, 1), ws.Cells(1, ultimaCol))
            .Font.Name = FUENTE
            .Font.Size = TAM_TITULO
            .Font.Bold = True
            .Font.Color = RGB(0, 0, 0)
            .HorizontalAlignment = xlCenter
        End With
    End If

    ' --- Cabecera (dos filas: nombres + correlativo) ---
    With ws.Range(ws.Cells(filaCab, 1), ws.Cells(filaCab + 1, ultimaCol))
        .Font.Size = TAM_CABECERA
        .Font.Bold = True
        .HorizontalAlignment = xlCenter
        .VerticalAlignment = xlCenter
        .WrapText = True
        .Interior.Color = RGB(217, 217, 217)
    End With
    ws.Rows(filaCab).RowHeight = 34

    ' Cabecera de las estadisticas en verde
    With ws.Range(ws.Cells(filaCab, colEstadis), ws.Cells(filaCab + 1, colEstadis + 3))
        .Interior.Color = RGB(204, 255, 204)
    End With

    ' --- Cuerpo ---
    For f = filaCab + 2 To ultimaFila
        If EsFilaSeccion(ws, f, colPrimerLote, ultimaCol) Then
            With ws.Range(ws.Cells(f, 1), ws.Cells(f, ultimaCol))
                .Font.Bold = True
                .Interior.Color = RGB(231, 230, 230)
                .HorizontalAlignment = xlLeft
            End With
        Else
            ws.Cells(f, 1).HorizontalAlignment = xlLeft
            ws.Cells(f, 1).WrapText = True
            ws.Cells(f, 2).HorizontalAlignment = xlCenter
            ws.Cells(f, 2).WrapText = True

            With ws.Range(ws.Cells(f, colPrimerLote), ws.Cells(f, colEstadis - 1))
                .HorizontalAlignment = xlCenter
                .NumberFormat = FORMATO_DATOS
            End With

            With ws.Range(ws.Cells(f, colEstadis), ws.Cells(f, colEstadis + 3))
                .HorizontalAlignment = xlCenter
                .Interior.Color = RGB(204, 255, 204)
                .NumberFormat = FORMATO_ESTADIS
            End With

            ' Los "---" de las filas cualitativas no llevan formato numerico
            For c = colEstadis To colEstadis + 3
                If ws.Cells(f, c).Value = "---" Then
                    ws.Cells(f, c).NumberFormat = "@"
                End If
            Next c

            ws.Rows(f).RowHeight = 20
        End If
    Next f

    ' --- Vistos buenos en Wingdings ---
    For Each celda In ws.Range(ws.Cells(filaCab + 2, colPrimerLote), ws.Cells(ultimaFila, colEstadis - 1))
        If celda.Value = ChrW(252) Then   ' ChrW(252) es el visto bueno en Wingdings
            celda.Font.Name = "Wingdings"
            celda.HorizontalAlignment = xlCenter
        End If
    Next celda

    ' --- Anchos de columna ---
    ws.Columns(1).ColumnWidth = ANCHO_PARAMETRO
    ws.Columns(2).ColumnWidth = ANCHO_SETPOINT
    For c = colPrimerLote To colEstadis - 1
        ws.Columns(c).ColumnWidth = ANCHO_LOTE
    Next c
    For c = colEstadis To colEstadis + 3
        ws.Columns(c).ColumnWidth = ANCHO_ESTADIS
    Next c

    ' --- Inmovilizar paneles ---
    ws.Activate
    ActiveWindow.FreezePanes = False
    ws.Cells(filaCab + 2, colPrimerLote).Select
    ActiveWindow.FreezePanes = True
    ws.Cells(1, 1).Select

    FormatearHoja = True
End Function

' Localiza la fila de cabecera buscando "Parametros" en la columna A.
Private Function BuscarFilaCabecera(ws As Worksheet) As Long
    Dim f As Long, t As String
    For f = 1 To 15
        t = LCase$(Trim$(CStr(ws.Cells(f, 1).Value)))
        If t = "parametros" Or t = "par" & ChrW(225) & "metros" Then
            BuscarFilaCabecera = f
            Exit Function
        End If
    Next f
End Function

' Localiza la columna donde empiezan las estadisticas buscando "Minimo".
Private Function BuscarColumnaEstadistica(ws As Worksheet, filaCab As Long, ultimaCol As Long) As Long
    Dim c As Long, t As String
    For c = 3 To ultimaCol
        t = LCase$(Trim$(CStr(ws.Cells(filaCab, c).Value)))
        If t = "minimo" Or t = "m" & ChrW(237) & "nimo" Then
            BuscarColumnaEstadistica = c
            Exit Function
        End If
    Next c
End Function

' Una fila de seccion trae texto solo en la columna A.
Private Function EsFilaSeccion(ws As Worksheet, f As Long, colPrimerLote As Long, ultimaCol As Long) As Boolean
    Dim c As Long
    If Len(Trim$(CStr(ws.Cells(f, 1).Value))) = 0 Then Exit Function
    If Len(Trim$(CStr(ws.Cells(f, 2).Value))) > 0 Then Exit Function
    For c = colPrimerLote To ultimaCol
        If Len(Trim$(CStr(ws.Cells(f, c).Value))) > 0 Then Exit Function
    Next c
    EsFilaSeccion = True
End Function
`;

export function downloadMacro() {
  const blob = new Blob([MACRO_VBA], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${MACRO_MODULE_NAME}.bas`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
